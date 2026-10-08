import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // @whatsatendende/types is a CommonJS workspace package reached through a
  // node_modules symlink — both Vite's dev-time dependency pre-bundling and
  // its production Rollup build resolve symlinks to the package's real path
  // (packages/types/dist/...), which falls outside the default
  // node_modules/** glob each of them uses to decide what to run through
  // CJS-to-ESM interop. Left unset, only type-only imports from it work
  // (erased entirely at compile time, so they never hit this path); any
  // real value import fails to resolve — "X is not exported by ..." in a
  // production build, "does not provide an export named 'X'" in dev.
  optimizeDeps: {
    include: ["@whatsatendende/types"],
  },
  build: {
    commonjsOptions: {
      include: [/packages\/types\/dist/, /node_modules/],
    },
    rollupOptions: {
      output: {
        // pdf.js's worker is a ".mjs" file, and nginx's stock mime.types (the nginx:1.27 image's included) has no
        // entry for that extension — it was served as octet-stream, and a browser refuses to run a module script
        // that isn't JavaScript, so PDFs never drew (thumbnail and viewer both stayed empty). A ".js" name gets
        // application/javascript from any server.
        assetFileNames: (asset) => ((asset.names ?? [asset.name ?? ""]).some((name) => name.endsWith(".mjs")) ? "assets/[name]-[hash].js" : "assets/[name]-[hash][extname]"),
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": { target: "http://localhost:4000", changeOrigin: true },
      "/uploads": { target: "http://localhost:4000", changeOrigin: true },
      "/socket.io": { target: "http://localhost:4000", changeOrigin: true, ws: true },
    },
  },
});
