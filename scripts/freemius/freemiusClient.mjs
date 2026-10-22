import crypto from "node:crypto";

export function createFreemiusClient(config) {
  const {
    productId = "38794",
    publicKey = "pk_e6a0fc7ddb7371893cf0faafe3cc4",
    secretKey = "",
    devId = "19788",
    bearerToken = "",
    baseUrl = "https://api.freemius.com",
  } = config;

  function getHeaders(method, uri, bodyStr = "") {
    const headers = { Accept: "application/json" };
    if (bearerToken) {
      headers.Authorization = `Bearer ${bearerToken}`;
      if (bodyStr) headers["Content-Type"] = "application/json";
      return headers;
    }
    if (!secretKey) {
      throw new Error("Missing FREEMIUS_SECRET_KEY or FREEMIUS_BEARER_TOKEN.");
    }
    const authDate = new Date().toUTCString();
    const contentMd5 = bodyStr ? crypto.createHash("md5").update(bodyStr).digest("hex") : "";
    const contentType = bodyStr ? "application/json" : "";
    const stringToSign = [method.toUpperCase(), contentMd5, contentType, authDate, uri].join("\n");
    const signature = crypto.createHmac("sha256", secretKey).update(stringToSign).digest("base64");
    headers.Date = authDate;
    headers.Authorization = `FS ${devId}:${publicKey}:${signature}`;
    if (bodyStr) headers["Content-Type"] = "application/json";
    return headers;
  }

  async function request(method, uri, body = null, retries = 3) {
    const bodyStr = body ? JSON.stringify(body) : "";
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        const headers = getHeaders(method, uri, bodyStr);
        const res = await fetch(`${baseUrl}${uri}`, {
          method,
          headers,
          body: bodyStr || undefined,
        });
        if (res.status === 429 || res.status >= 500) {
          if (attempt === retries) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
          const backoff = 1000 * Math.pow(2, attempt - 1);
          await new Promise((r) => setTimeout(r, backoff));
          continue;
        }
        if (!res.ok) {
          const err = await res.text().catch(() => "");
          throw new Error(`Freemius ${method} ${uri} failed (${res.status}): ${err}`);
        }
        return await res.json();
      } catch (err) {
        if (attempt === retries) throw err;
        await new Promise((r) => setTimeout(r, 1000 * attempt));
      }
    }
  }

  async function fetchAllLicenses() {
    const all = [];
    let offset = 0;
    const pageSize = 50;
    while (true) {
      const uri = `/v1/products/${productId}/licenses.json?count=${pageSize}&offset=${offset}`;
      const res = await request("GET", uri);
      const list = res?.licenses || [];
      if (!list.length) break;
      all.push(...list);
      if (list.length < pageSize) break;
      offset += list.length;
    }
    return all;
  }

  async function getLifetimePricingId(planId) {
    const data = await request("GET", `/v1/products/${productId}/plans/${planId}/pricing.json`);
    const pricingList = data?.pricing || (Array.isArray(data) ? data : []);
    const lifetime = pricingList.find((p) => p.licenses === null || p.licenses === 1 || !p.annual_price);
    return (lifetime || pricingList[0])?.id || null;
  }

  return { productId, request, fetchAllLicenses, getLifetimePricingId };
}
