// Read an image File, downscale it to maxDim on its longest edge, and return a
// PNG data URL. Keeps transparency and stays small enough to store inline in
// the database as an artist reference — no separate file storage needed.
export async function fileToResizedDataUrl(file, maxDim = 1600) {
  if (!file.type.startsWith("image/")) throw new Error("Please choose an image file (PNG or JPG).");
  const dataUrl = await new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(new Error("Couldn't read that file."));
    r.readAsDataURL(file);
  });
  const img = await new Promise((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = () => reject(new Error("That doesn't look like a valid image."));
    i.src = dataUrl;
  });
  let { width, height } = img;
  const longest = Math.max(width, height);
  if (longest > maxDim) {
    const s = maxDim / longest;
    width = Math.round(width * s);
    height = Math.round(height * s);
  }
  const canvas = document.createElement("canvas");
  canvas.width = width || 1;
  canvas.height = height || 1;
  canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/png");
}
