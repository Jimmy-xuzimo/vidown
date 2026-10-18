#include <jni.h>
#include <cstring>
#include <cerrno>
#include <atomic>
#include <chrono>
#include <cmath>
#include <memory>
#include <mutex>
#include <map>
#include <stdexcept>
#include <string>
#include <sstream>
#include <vector>
#include <algorithm>
extern "C" {
#include <libavformat/avformat.h>
#include <libavcodec/avcodec.h>
#include <libavutil/dovi_meta.h>
#include <libavutil/log.h>
#include <libavutil/sha.h>
#include "quickjs.h"
}
namespace {
std::mutex lock;
std::map<std::string,std::shared_ptr<std::atomic_bool>> cancellations;
std::string text(JNIEnv* e,jstring s){if(!s)return {};const char* p=e->GetStringUTFChars(s,nullptr);std::string v(p);e->ReleaseStringUTFChars(s,p);return v;}
void checked(int code,const char* step){if(code<0)throw std::runtime_error(std::string(step)+"（"+std::to_string(code)+"）");}
void exception(JNIEnv* e){if(e->ExceptionCheck()){e->ExceptionClear();throw std::runtime_error("缓存读取或资源授权失败");}}
struct Owner{JNIEnv* env;jobject cache;std::shared_ptr<std::atomic_bool> stop;};
struct Reader{Owner* owner;std::string url,key,iv;jlong handle=0;int64_t pos=0,size=-1;};
jmethodID method(Owner* o,const char* name,const char* sig){auto cls=o->env->GetObjectClass(o->cache);auto m=o->env->GetMethodID(cls,name,sig);o->env->DeleteLocalRef(cls);exception(o->env);return m;}
void closeReader(Reader* r){if(!r->handle)return;auto o=r->owner;o->env->CallVoidMethod(o->cache,method(o,"close","(J)V"),r->handle);if(o->env->ExceptionCheck())o->env->ExceptionClear();r->handle=0;}
void openReader(Reader* r,int64_t position){
 auto o=r->owner;auto e=o->env;auto url=e->NewStringUTF(r->url.c_str());auto key=e->NewStringUTF(r->key.c_str());auto iv=e->NewStringUTF(r->iv.c_str());
 r->handle=e->CallLongMethod(o->cache,method(o,"open","(Ljava/lang/String;JLjava/lang/String;Ljava/lang/String;)J"),url,(jlong)position,key,iv);
 e->DeleteLocalRef(url);e->DeleteLocalRef(key);e->DeleteLocalRef(iv);exception(e);r->pos=position;
 r->size=e->CallLongMethod(o->cache,method(o,"size","(J)J"),r->handle);exception(e);
}
int readPacket(void* opaque,uint8_t* buf,int size){
 auto r=static_cast<Reader*>(opaque);auto o=r->owner;if(o->stop->load())return AVERROR_EXIT;
 try{auto e=o->env;auto data=(jbyteArray)e->CallObjectMethod(o->cache,method(o,"read","(JI)[B"),r->handle,(jint)std::min(size,262144));exception(e);if(!data)return AVERROR(EIO);int n=e->GetArrayLength(data);if(n>size){e->DeleteLocalRef(data);return AVERROR(EIO);}if(n)e->GetByteArrayRegion(data,0,n,(jbyte*)buf);e->DeleteLocalRef(data);r->pos+=n;return n?n:AVERROR_EOF;}catch(...){return AVERROR(EIO);}
}
int64_t seekPacket(void* opaque,int64_t offset,int whence){
 auto r=static_cast<Reader*>(opaque);if(whence&AVSEEK_SIZE)return r->size;
 whence&=~AVSEEK_FORCE;int64_t next=whence==SEEK_SET?offset:whence==SEEK_CUR?r->pos+offset:whence==SEEK_END&&r->size>=0?r->size+offset:-1;
 if(next<0)return AVERROR(ENOSYS);try{closeReader(r);openReader(r,next);return next;}catch(...){return AVERROR(EIO);}
}
int ioOpen(AVFormatContext* f,AVIOContext** pb,const char* url,int flags,AVDictionary** options){
 if(flags&AVIO_FLAG_WRITE)return AVERROR(EACCES);auto owner=static_cast<Owner*>(f->opaque);if(!owner||!owner->cache)return AVERROR(EACCES);
 try{auto r=std::make_unique<Reader>();r->owner=owner;r->url=url;
  if(options){auto key=av_dict_get(*options,"key",nullptr,0);auto iv=av_dict_get(*options,"iv",nullptr,0);if(key)r->key=key->value;if(iv)r->iv=iv->value;}
  openReader(r.get(),0);auto buffer=(uint8_t*)av_malloc(65536);if(!buffer)throw std::bad_alloc();
  auto io=avio_alloc_context(buffer,65536,0,r.get(),readPacket,nullptr,seekPacket);if(!io){av_free(buffer);throw std::bad_alloc();}*pb=io;r.release();return 0;
 }catch(...){return AVERROR(EIO);}
}
int ioClose(AVFormatContext*,AVIOContext* pb){if(!pb)return 0;auto r=static_cast<Reader*>(pb->opaque);closeReader(r);delete r;av_freep(&pb->buffer);avio_context_free(&pb);return 0;}
int interrupted(void* opaque){return static_cast<Owner*>(opaque)->stop->load()?1:0;}
struct Input{AVFormatContext* format=nullptr;AVPacket* packet=av_packet_alloc();std::vector<int> mapping;std::vector<int64_t> lastDts,lastDuration;int64_t base=0,offset=0;bool ready=false;~Input(){av_packet_free(&packet);avformat_close_input(&format);}};
std::unique_ptr<Input> openInput(const std::string& path,Owner* owner){
 auto input=std::make_unique<Input>();input->format=avformat_alloc_context();if(!input->format)throw std::bad_alloc();
 input->format->opaque=owner;input->format->interrupt_callback={interrupted,owner};
 if(owner->cache){input->format->io_open=ioOpen;input->format->io_close2=ioClose;}
 AVDictionary* opts=nullptr;
 if(!owner->cache)av_dict_set(&opts,"format_whitelist","mov,mp4,m4a,3gp,3g2,mj2,matroska,webm,mpegts,aac,flac,mp3,ogg,wav,ac3,eac3",0);
 av_dict_set(&opts,"protocol_whitelist",owner->cache?"http,https,crypto,file":"file",0);av_dict_set(&opts,"allowed_extensions","ALL",0);
 int ret=avformat_open_input(&input->format,path.c_str(),nullptr,&opts);av_dict_free(&opts);checked(ret,"无法读取媒体");
 checked(avformat_find_stream_info(input->format,nullptr),"无法读取轨道信息");
 input->base=input->format->start_time==AV_NOPTS_VALUE?0:input->format->start_time;
 input->lastDts.assign(input->format->nb_streams,AV_NOPTS_VALUE);input->lastDuration.assign(input->format->nb_streams,0);return input;
}
bool advance(Input& input){
 while(true){av_packet_unref(input.packet);int result=av_read_frame(input.format,input.packet);if(result==AVERROR_EOF){input.ready=false;return false;}checked(result,"媒体数据不完整");if(input.packet->stream_index<(int)input.mapping.size()&&input.mapping[input.packet->stream_index]>=0){
  auto p=input.packet;int index=p->stream_index;auto tb=input.format->streams[index]->time_base;
  if((input.format->iformat->flags&AVFMT_TS_DISCONT)&&p->dts!=AV_NOPTS_VALUE){
   auto time=av_rescale_q(p->dts,tb,AV_TIME_BASE_Q)-input.base+input.offset;
   // HLS/TS may reset its clock at a discontinuity. Share the correction
   // across audio/video in this input, preserving their relative timing and
   // encoded packets. Do not close intentional forward gaps in the source.
   if(input.lastDts[index]!=AV_NOPTS_VALUE&&time<input.lastDts[index]-500000){
    auto next=input.lastDts[index]+std::max<int64_t>(1,input.lastDuration[index]);input.offset+=next-time;time=next;
   }
   input.lastDts[index]=time;input.lastDuration[index]=av_rescale_q(p->duration,tb,AV_TIME_BASE_Q);
  }
  input.ready=true;return true;
 }}
}
std::string scan(Input& input,int64_t& count){
 std::vector<AVSHA*> hashes;for(unsigned i=0;i<input.format->nb_streams;i++){auto h=av_sha_alloc();if(!h)throw std::bad_alloc();av_sha_init(h,256);hashes.push_back(h);}
 struct HashGuard{std::vector<AVSHA*>& h;~HashGuard(){for(auto p:h)av_free(p);}} guard{hashes};
 while(advance(input)){if(interrupted(input.format->opaque))throw std::runtime_error("任务已取消");auto p=input.packet;av_sha_update(hashes[p->stream_index],p->data,p->size);count++;}
 std::ostringstream result;result<<"[";bool comma=false;
 for(unsigned i=0;i<input.format->nb_streams;i++){auto c=input.format->streams[i]->codecpar;if(c->codec_type!=AVMEDIA_TYPE_VIDEO&&c->codec_type!=AVMEDIA_TYPE_AUDIO)continue;if(comma)result<<",";comma=true;
  uint8_t digest[32];av_sha_final(hashes[i],digest);const char* hex="0123456789abcdef";result<<"\"";for(auto b:digest)result<<hex[b>>4]<<hex[b&15];result<<"\"";
 }
 result<<"]";return result.str();
}
std::string describe(AVFormatContext* f){
 std::ostringstream s;s<<"[";bool comma=false;
 for(unsigned n=0;n<f->nb_streams;n++){auto stream=f->streams[n];auto c=stream->codecpar;if(c->codec_type!=AVMEDIA_TYPE_VIDEO&&c->codec_type!=AVMEDIA_TYPE_AUDIO)continue;if(comma)s<<",";comma=true;
  double fps=av_q2d(stream->avg_frame_rate);
  s<<"{\"kind\":\""<<(c->codec_type==AVMEDIA_TYPE_VIDEO?"VIDEO":"AUDIO")<<"\",\"codec\":\""<<avcodec_get_name(c->codec_id)<<"\",\"width\":"<<c->width<<",\"height\":"<<c->height<<",\"sampleRate\":"<<c->sample_rate<<",\"bitDepth\":"<<(c->bits_per_raw_sample?c->bits_per_raw_sample:c->bits_per_coded_sample)<<",\"channels\":"<<c->ch_layout.nb_channels<<",\"colorPrimaries\":"<<c->color_primaries<<",\"colorTransfer\":"<<c->color_trc<<",\"colorSpace\":"<<c->color_space<<",\"fps\":"<<(std::isfinite(fps)?fps:0)<<",\"profile\":"<<c->profile<<",\"dolbyVision\":";
  bool dovi=false;for(int i=0;i<c->nb_coded_side_data;i++)if(c->coded_side_data[i].type==AV_PKT_DATA_DOVI_CONF)dovi=true;s<<(dovi?"true":"false")<<"}";
 }
 s<<"]";return s.str();
}
void checkPreservation(AVCodecParameters* source,AVCodecParameters* output){
 if(source->codec_id!=output->codec_id||source->codec_type!=output->codec_type)throw std::runtime_error("成品编码与源轨不一致");
 if(source->codec_type==AVMEDIA_TYPE_VIDEO&&(source->width!=output->width||source->height!=output->height||source->color_primaries!=output->color_primaries||source->color_trc!=output->color_trc||source->color_space!=output->color_space))throw std::runtime_error("成品视频规格与源轨不一致");
 if(source->codec_type==AVMEDIA_TYPE_AUDIO&&(source->sample_rate!=output->sample_rate||source->ch_layout.nb_channels!=output->ch_layout.nb_channels))throw std::runtime_error("成品音频规格与源轨不一致");
 if(source->codec_type==AVMEDIA_TYPE_AUDIO && source->bits_per_raw_sample>0 && source->bits_per_raw_sample!=output->bits_per_raw_sample)throw std::runtime_error("成品音频位深与源轨不一致");
 for(int i=0;i<source->nb_coded_side_data;i++){
  auto side=source->coded_side_data[i];if(side.type!=AV_PKT_DATA_DOVI_CONF&&side.type!=AV_PKT_DATA_MASTERING_DISPLAY_METADATA&&side.type!=AV_PKT_DATA_CONTENT_LIGHT_LEVEL)continue;
  bool found=false;for(int j=0;j<output->nb_coded_side_data;j++){auto dst=output->coded_side_data[j];if(side.type==dst.type&&side.size==dst.size&&memcmp(side.data,dst.data,side.size)==0)found=true;}
  if(!found)throw std::runtime_error("成品未完整保留动态范围元数据");
 }
}
std::string process(JNIEnv* env,const std::string& id,const std::vector<std::string>& paths,const std::vector<std::string>& kinds,const std::string& output,jobject cache){
 auto stop=std::make_shared<std::atomic_bool>(false);{std::lock_guard<std::mutex> g(lock);cancellations[id]=stop;}
 struct Cleanup{std::string id;~Cleanup(){std::lock_guard<std::mutex>g(lock);cancellations.erase(id);}} cleanup{id};
 Owner owner{env,cache,stop};std::vector<std::unique_ptr<Input>> sources;bool separateAudio=std::find(kinds.begin(),kinds.end(),"AUDIO")!=kinds.end();
 for(auto& path:paths)sources.push_back(openInput(path,&owner));
 if(output.empty()){
  auto& input=*sources.at(0);input.mapping.assign(input.format->nb_streams,0);int64_t count=0;auto hashes=scan(input,count);if(count==0)throw std::runtime_error("媒体为空");return "{\"container\":\""+std::string(input.format->iformat->name)+"\",\"streams\":"+describe(input.format)+",\"packetHashes\":"+hashes+",\"packets\":"+std::to_string(count)+",\"duration\":"+std::to_string(input.format->duration/(double)AV_TIME_BASE)+"}";
 }
 const auto extension=output.substr(output.find_last_of('.')+1);const char* format=extension=="m4a"?"mp4":extension=="mka"?"matroska":nullptr;
 AVFormatContext* out=nullptr;checked(avformat_alloc_output_context2(&out,nullptr,format,output.c_str()),"无法创建输出容器");
 struct OutGuard{AVFormatContext* f;~OutGuard(){if(f){if(f->pb)avio_closep(&f->pb);avformat_free_context(f);}}} guard{out};
 std::vector<AVCodecParameters*> expected;
 for(size_t n=0;n<sources.size();n++){
  auto& in=*sources[n];in.mapping.assign(in.format->nb_streams,-1);
  for(unsigned i=0;i<in.format->nb_streams;i++){
   auto stream=in.format->streams[i];auto c=stream->codecpar;
   bool use=(c->codec_type==AVMEDIA_TYPE_VIDEO&&kinds[n]!="AUDIO")||(c->codec_type==AVMEDIA_TYPE_AUDIO&&kinds[n]!="VIDEO"&&!(kinds[n]=="MUXED"&&separateAudio));if(!use)continue;
   auto dst=avformat_new_stream(out,nullptr);if(!dst)throw std::bad_alloc();checked(avcodec_parameters_copy(dst->codecpar,c),"无法复制源规格");dst->codecpar->codec_tag=0;dst->time_base=stream->time_base;dst->avg_frame_rate=stream->avg_frame_rate;av_dict_copy(&dst->metadata,stream->metadata,0);in.mapping[i]=dst->index;expected.push_back(c);
  }
 }
 if(expected.empty())throw std::runtime_error("所选轨道不包含音视频");
 checked(avio_open(&out->pb,output.c_str(),AVIO_FLAG_WRITE),"无法写入临时文件");checked(avformat_write_header(out,nullptr),"此容器无法安全保存所选规格");
 for(auto& source:sources)advance(*source);
 int64_t count=0;
 while(true){
  if(stop->load())throw std::runtime_error("任务已取消");Input* selected=nullptr;int64_t earliest=INT64_MAX;
  for(auto& source:sources){if(!source->ready)continue;auto pkt=source->packet;auto tb=source->format->streams[pkt->stream_index]->time_base;auto ts=pkt->dts==AV_NOPTS_VALUE?pkt->pts:pkt->dts;auto time=ts==AV_NOPTS_VALUE?0:av_rescale_q(ts,tb,AV_TIME_BASE_Q)-source->base+source->offset;if(!selected||time<earliest){selected=source.get();earliest=time;}}
  if(!selected)break;auto pkt=selected->packet;int src=pkt->stream_index;auto srcTb=selected->format->streams[src]->time_base;auto dst=out->streams[selected->mapping[src]];
  const auto shift=av_rescale_q(selected->base-selected->offset,AV_TIME_BASE_Q,srcTb);if(pkt->pts!=AV_NOPTS_VALUE)pkt->pts-=shift;if(pkt->dts!=AV_NOPTS_VALUE)pkt->dts-=shift;
  av_packet_rescale_ts(pkt,srcTb,dst->time_base);pkt->stream_index=dst->index;pkt->pos=-1;checked(av_interleaved_write_frame(out,pkt),"成品写入失败");count++;advance(*selected);
 }
 checked(av_write_trailer(out),"成品未完整提交");checked(avio_closep(&out->pb),"成品写入失败");
 Owner verifyOwner{env,nullptr,stop};auto verify=openInput(output,&verifyOwner);
 std::vector<AVCodecParameters*> actual;for(unsigned i=0;i<verify->format->nb_streams;i++){auto c=verify->format->streams[i]->codecpar;if(c->codec_type==AVMEDIA_TYPE_VIDEO||c->codec_type==AVMEDIA_TYPE_AUDIO)actual.push_back(c);}
 if(actual.size()!=expected.size())throw std::runtime_error("成品轨道数量不一致");for(size_t i=0;i<expected.size();i++)checkPreservation(expected[i],actual[i]);
 verify->mapping.assign(verify->format->nb_streams,0);int64_t verified=0;auto hashes=scan(*verify,verified);if(verified==0||count==0)throw std::runtime_error("成品没有有效媒体包");
 return "{\"container\":\""+std::string(verify->format->iformat->name)+"\",\"streams\":"+describe(verify->format)+",\"packetHashes\":"+hashes+",\"packets\":"+std::to_string(verified)+",\"duration\":"+std::to_string(verify->format->duration/(double)AV_TIME_BASE)+"}";
}
}
extern "C" JNIEXPORT jstring JNICALL Java_top_xuzimo_vidown_engine_NativeMedia_process(JNIEnv* e,jclass,jstring id,jobjectArray paths,jobjectArray kinds,jstring output,jobject cache){
 try{av_log_set_level(AV_LOG_QUIET);std::vector<std::string> p,k;for(int i=0;i<e->GetArrayLength(paths);i++){auto x=(jstring)e->GetObjectArrayElement(paths,i);p.push_back(text(e,x));e->DeleteLocalRef(x);auto y=(jstring)e->GetObjectArrayElement(kinds,i);k.push_back(text(e,y));e->DeleteLocalRef(y);}auto result=process(e,text(e,id),p,k,text(e,output),cache);return e->NewStringUTF(result.c_str());}
 catch(const std::exception& error){e->ThrowNew(e->FindClass("java/lang/IllegalStateException"),error.what());return nullptr;}
}
extern "C" JNIEXPORT void JNICALL Java_top_xuzimo_vidown_engine_NativeMedia_cancel(JNIEnv* e,jclass,jstring id){std::lock_guard<std::mutex>g(lock);auto it=cancellations.find(text(e,id));if(it!=cancellations.end())it->second->store(true);}
extern "C" JNIEXPORT jstring JNICALL Java_top_xuzimo_vidown_engine_NativeMedia_evaluate(JNIEnv* e,jclass,jstring source){
 auto runtime=JS_NewRuntime();JS_SetMemoryLimit(runtime,128*1024*1024);JS_SetMaxStackSize(runtime,512*1024);
 auto deadline=std::chrono::steady_clock::now()+std::chrono::seconds(30);JS_SetInterruptHandler(runtime,[](JSRuntime*,void* p)->int{return std::chrono::steady_clock::now()>*static_cast<std::chrono::steady_clock::time_point*>(p);},&deadline);
 auto ctx=JS_NewContext(runtime);auto script=text(e,source);auto value=JS_Eval(ctx,script.data(),script.size(),"vidown-challenge",JS_EVAL_TYPE_GLOBAL);
 std::string result;bool failed=JS_IsException(value);
 while(!failed && JS_IsJobPending(runtime)){
  if(std::chrono::steady_clock::now()>deadline){failed=true;break;}
  JSContext* jobContext=nullptr;if(JS_ExecutePendingJob(runtime,&jobContext)<0)failed=true;
 }
 if(!failed){auto global=JS_GetGlobalObject(ctx);auto captured=JS_GetPropertyStr(ctx,global,"__vidownOutput");JS_FreeValue(ctx,global);if(JS_IsString(captured)){JS_FreeValue(ctx,value);value=captured;}else JS_FreeValue(ctx,captured);}
 if(!failed){const char* s=JS_ToCString(ctx,value);if(s){result=s;JS_FreeCString(ctx,s);}else failed=true;}
 JS_FreeValue(ctx,value);JS_FreeContext(ctx);JS_FreeRuntime(runtime);
 if(failed){e->ThrowNew(e->FindClass("java/lang/IllegalStateException"),"JavaScript 提取执行失败或超过限制");return nullptr;}return e->NewStringUTF(result.c_str());
}
