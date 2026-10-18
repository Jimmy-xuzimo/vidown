package top.xuzimo.vidown.engine;
interface ICacheBridge {
    long open(String url, long position, String key, String iv);
    byte[] read(long handle, int size);
    long size(long handle);
    void close(long handle);
}
