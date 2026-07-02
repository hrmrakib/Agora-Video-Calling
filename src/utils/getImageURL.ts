const baseImg_url = process.env.NEXT_PUBLIC_IMAGE_URL || "";

export const getImageURL = (path: string | undefined | null) => {
  if (!path) return "/images/placeholder.png";
  if (path.startsWith("http") || path.startsWith("/images/")) return path;

  // Ensures we don't accidentally double-slash if baseImg_url ends with / or path starts with /
  const cleanBase = baseImg_url.endsWith("/")
    ? baseImg_url.slice(0, -1)
    : baseImg_url;
  const cleanPath = path.startsWith("/") ? path : `/${path}`;

  return `${cleanBase}${cleanPath}`;
};
