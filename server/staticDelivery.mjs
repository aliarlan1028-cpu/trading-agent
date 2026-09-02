import express from "express";
import path from "node:path";

export function staticDocumentForPath(pathname) {
  if (pathname === "/" || pathname === "/landing.html") return "landing.html";
  if (pathname === "/app" || pathname === "/app/" || pathname.startsWith("/app/")) return "index.html";
  return "landing.html";
}

export function cacheControlForStatic(filePath) {
  if (/[\\/]assets[\\/]/.test(filePath)) {
    return "public, max-age=31536000, immutable";
  }
  return "no-cache";
}

export function staticContentSecurityPolicy() {
  return "default-src 'self'; connect-src 'self' https: wss:; img-src 'self' data: https:; style-src 'self' 'unsafe-inline'; font-src 'self' data:; script-src 'self'; frame-src 'self'; frame-ancestors 'self'";
}

export function installStaticDelivery(app, { publicDir }) {
  const staticAssets = express.static(publicDir, {
    index: false,
    setHeaders(res, filePath) {
      res.setHeader("Cache-Control", cacheControlForStatic(filePath));
    }
  });
  app.use((req, res, next) => {
    if (req.path === "/api" || req.path.startsWith("/api/")) return next();
    return staticAssets(req, res, next);
  });
  app.get(/^\/(?!api(?:\/|$)).*/, (req, res, next) => {
    res.setHeader("Cache-Control", "no-cache");
    res.sendFile(path.join(publicDir, staticDocumentForPath(req.path)), (error) => {
      if (error) next(error);
    });
  });
}
