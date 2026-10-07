/** A file's bytes as base64, for upload over the socket. */
export const toBase64 = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.addEventListener("load", () => resolve(String(r.result).split(",")[1] ?? ""));
    r.addEventListener("error", () => reject(r.error));
    r.readAsDataURL(file);
  });
