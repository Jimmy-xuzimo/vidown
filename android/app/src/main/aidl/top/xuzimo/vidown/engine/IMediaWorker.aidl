package top.xuzimo.vidown.engine;
import top.xuzimo.vidown.engine.ICacheBridge;
import top.xuzimo.vidown.engine.IMediaCallback;
interface IMediaWorker {
    void process(String id, in String[] inputs, in String[] kinds, String output, ICacheBridge cache, IMediaCallback callback);
    void cancel(String id);
}
