import axios, { CancelTokenSource } from "axios";

import { Result } from "@/domains/result/index";

import { HttpClientCore } from "./index";

export function connect(store: HttpClientCore, extra: Partial<{ timeout: number }> = {}) {
  let requests: { id: string; source: CancelTokenSource }[] = [];
  store.fetch = async (options) => {
    const { url, method, id, data, headers, timeout = 2000 } = options;
    const source = axios.CancelToken.source();
    if (id) {
      requests.push({
        id,
        source,
      });
    }
    if (method === "GET") {
      try {
        console.log("[DOMAIN]http_client/provider.axios - before axios.get", url);
        const r = await axios.get(url, {
          params: data,
          headers,
          cancelToken: source.token,
          timeout: extra.timeout || timeout,
        });
        requests = requests.filter((r) => r.id !== id);
        return r;
      } catch (err) {
        requests = requests.filter((r) => r.id !== id);
        throw err;
      }
    }
    if (method === "POST") {
      try {
        const r = await axios.post(url, data, {
          headers,
          cancelToken: source.token,
          timeout: extra.timeout || timeout,
        });
        requests = requests.filter((r) => r.id !== id);
        return r;
      } catch (err) {
        requests = requests.filter((r) => r.id !== id);
        throw err;
      }
    }
    return Promise.reject("unknown method");
  };
  store.cancel = (id: string) => {
    const matched = requests.find((r) => r.id === id);
    if (!matched) {
      return Result.Err("没有找到对应请求");
    }
    requests = requests.filter((r) => r.id !== id);
    matched.source.cancel("主动取消");
    return Result.Ok(null);
  };
}
