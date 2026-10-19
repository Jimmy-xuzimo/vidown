"use strict";
const contexts = new Map();
let proxy = "system";
let port;
let epoch = null;
const MAX_MANIFEST = 1024 * 1024;
function send(data) { try { port.postMessage(data); } catch (_) {} }
function connect() {
  port = browser.runtime.connectNative("vidown");
  port.onDisconnect.addListener(() => setTimeout(connect, 1000));
  port.onMessage.addListener(async msg => {
    if (msg.kind === "epoch") { epoch = msg.value; contexts.clear(); }
    if (msg.kind === "cookieSnapshot") { const token=epoch; send({kind:"cookieSnapshot", epoch:token, id:msg.id, cookies:await browser.cookies.getAll({})}); }
    if (msg.kind === "proxy" && typeof msg.value === "string") proxy = msg.value;
    if (msg.kind === "restoreCookies" && Array.isArray(msg.cookies)) {
      const current = await browser.cookies.getAll({session:true});
      const present = new Set(current.map(c => `${c.domain}|${c.path}|${c.name}|${c.storeId}`));
      for (const c of msg.cookies.slice(0, 3000)) {
        if (msg.epoch !== epoch) break;
        if (!c.session || c.partitionKey || c.firstPartyDomain || present.has(`${c.domain}|${c.path}|${c.name}|${c.storeId}`)) continue;
        try {
          const host = c.domain.replace(/^\./, "");
          await browser.cookies.set({url:`${c.secure ? "https" : "http"}://${host}${c.path}`, name:c.name, value:c.value, domain:c.hostOnly ? undefined : c.domain, path:c.path, secure:c.secure, httpOnly:c.httpOnly, sameSite:c.sameSite, storeId:c.storeId});
        } catch (_) {}
      }
      if(msg.epoch===epoch)send({kind:"cookiesRestored",epoch});
    }
  });
  send({kind:"ready"});
}
connect();
browser.runtime.onMessage.addListener((msg, sender) => {
  if (msg.kind === "identify") return Promise.resolve(sender.tab.id);
  if (msg.kind === "siteData" && sender.tab && typeof msg.data === "string" && msg.data.length <= MAX_MANIFEST) {
    try {
      const u = new URL(sender.url);
      if (["www.douyin.com", "douyin.com", "www.iesdouyin.com", "iesdouyin.com"].includes(u.hostname))
        send({kind:"siteData", epoch, webTabId:sender.tab.id, url:sender.url, data:msg.data});
    } catch (_) { /* A frame may have navigated away. */ }
  }
});
browser.proxy.onRequest.addListener(() => {
  if (proxy === "system") return undefined;
  if (proxy === "direct") return {type:"direct"};
  try { const u = new URL(proxy); return {type:u.protocol === "socks5:" ? "socks" : u.protocol === "https:" ? "https" : "http", host:u.hostname, port:Number(u.port), proxyDNS:u.protocol === "socks5:"}; }
  catch (_) { return {type:"direct"}; }
}, {urls:["<all_urls>"]});
browser.webRequest.onBeforeSendHeaders.addListener(d => {
  if (d.tabId < 0) return;
  const headers = {};
  for (const h of d.requestHeaders || []) {
    if (/^(referer|origin|user-agent|authorization|accept|accept-language|x-[\w-]+)$/i.test(h.name) && typeof h.value === "string") headers[h.name] = h.value;
  }
  contexts.set(d.requestId, {headers, pageUrl:d.originUrl || d.documentUrl || "", tabId:d.tabId, epoch});
  if (contexts.size > 5000) contexts.delete(contexts.keys().next().value);
}, {urls:["<all_urls>"]}, ["requestHeaders"]);
browser.webRequest.onHeadersReceived.addListener(d => {
  const ctx = contexts.get(d.requestId);
  if (!ctx || d.statusCode < 200 || d.statusCode >= 300) return;
  const mime = (d.responseHeaders || []).find(h => h.name.toLowerCase() === "content-type")?.value || "";
  const isHls = /mpegurl/i.test(mime) || /\.m3u8(?:[?#]|$)/i.test(d.url);
  const isDash = /dash\+xml/i.test(mime) || /\.mpd(?:[?#]|$)/i.test(d.url);
  let isDetail = false;
  try {
    const u = new URL(d.url);
    isDetail = ["www.douyin.com", "douyin.com"].includes(u.hostname) &&
      /^\/aweme\/v\d+\/web\/(?:aweme\/(?:detail|post)|tab\/feed|feed)\//.test(u.pathname) && /json/i.test(mime);
  } catch (_) { /* Non-HTTP requests are ignored. */ }
  if (!isHls && !isDash && !isDetail && !/^(video|audio)\//i.test(mime)) return;
  const record = {kind:"capture", epoch:ctx.epoch, webTabId:ctx.tabId, url:d.url, pageUrl:ctx.pageUrl, headers:ctx.headers, contentType:mime, protocol:isHls?"HLS":isDash?"DASH":"HTTP"};
  if (!isDetail) send(record);
  if (isHls || isDash || isDetail) {
    try {
      const filter = browser.webRequest.filterResponseData(d.requestId);
      let size = 0; const chunks = [];
      filter.ondata = e => { filter.write(e.data); size += e.data.byteLength; if (size <= MAX_MANIFEST) chunks.push(new Uint8Array(e.data)); else chunks.length=0; };
      filter.onstop = () => {
        filter.close();
        if (size <= MAX_MANIFEST) {
          const joined=new Uint8Array(size); let offset=0; for(const c of chunks){joined.set(c,offset);offset+=c.length;}
          const text = new TextDecoder().decode(joined);
          if (isDetail) {
            try { JSON.parse(text); send({kind:"siteData",epoch:ctx.epoch,webTabId:ctx.tabId,url:d.url,data:text}); }
            catch (_) { /* Invalid JSON cannot become a media resource. */ }
          } else send({...record,manifest:text});
        }
      };
      filter.onerror = () => { try {filter.disconnect();} catch (_) {} };
    } catch (_) { /* Discovery still works; the task can fetch the manifest in-session. */ }
  }
}, {urls:["<all_urls>"]}, ["responseHeaders", "blocking"]);
for (const event of [browser.webRequest.onCompleted,browser.webRequest.onErrorOccurred]) event.addListener(d => contexts.delete(d.requestId),{urls:["<all_urls>"]});
let cookieTimer;
browser.cookies.onChanged.addListener(() => {
  clearTimeout(cookieTimer);
  cookieTimer=setTimeout(async()=>{const token=epoch;const cookies=await browser.cookies.getAll({session:true});if(cookies.length<=3000)send({kind:"cookies",epoch:token,cookies});},700);
});
