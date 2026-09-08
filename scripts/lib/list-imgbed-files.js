export async function listImgbedFiles({
  endpoint,
  apiToken = "",
  pageSize = 200,
  listDir = "",
  recursive = true,
  maxPages = 200,
  maxFiles = 10000,
}) {
  const allFiles = [];
  const seenPages = new Set();
  let start = 0;

  for (let page = 1; page <= maxPages; page++) {
    const apiUrl = new URL(endpoint);
    apiUrl.searchParams.set("start", String(start));
    apiUrl.searchParams.set("count", String(pageSize));
    apiUrl.searchParams.set("fileType", "image");
    apiUrl.searchParams.set("accessStatus", "normal");
    if (recursive) apiUrl.searchParams.set("recursive", "true");
    if (listDir) apiUrl.searchParams.set("dir", listDir);

    const headers = { Accept: "application/json" };
    if (apiToken) {
      headers.Authorization = apiToken.toLowerCase().startsWith("bearer ") ? apiToken : `Bearer ${apiToken}`;
    }
    const response = await fetch(apiUrl, { headers, signal: AbortSignal.timeout(30000) });
    if (!response.ok) throw new Error(`ImgBed 列表请求失败: HTTP ${response.status}`);

    const payload = await response.json();
    if (!Array.isArray(payload?.files)) throw new Error("ImgBed 列表响应缺少 files 数组。");
    const files = payload.files;
    if (files.length === 0) return allFiles;

    const signature = JSON.stringify(files.map((item) => item?.name || item?.path || item?.src || item));
    if (seenPages.has(signature)) throw new Error(`ImgBed 第 ${page} 页重复，分页未前进。`);
    seenPages.add(signature);

    const returnedCount = payload.returnedCount == null ? files.length : Number(payload.returnedCount);
    if (!Number.isSafeInteger(returnedCount) || returnedCount <= 0) {
      throw new Error(`ImgBed 第 ${page} 页 returnedCount 无效，分页未前进。`);
    }
    if (returnedCount !== files.length) {
      throw new Error(`ImgBed 第 ${page} 页 returnedCount 与文件数量不一致，未写入不完整索引。`);
    }
    if (allFiles.length + files.length > maxFiles) {
      throw new Error(`ImgBed 列表超过 ${maxFiles} 个文件的上限，未写入不完整索引。`);
    }
    allFiles.push(...files);

    const totalCount = payload.totalCount == null ? null : Number(payload.totalCount);
    if (returnedCount < pageSize || (Number.isSafeInteger(totalCount) && totalCount >= 0 && allFiles.length >= totalCount)) {
      return allFiles;
    }
    start += returnedCount;
  }

  throw new Error(`ImgBed 分页超过 ${maxPages} 页的上限，未写入不完整索引。`);
}
