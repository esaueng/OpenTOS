import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
export default defineConfig({
    plugins: [react()],
    resolve: {
        alias: {
            "@contracts": path.resolve(__dirname, "../../packages/contracts/src")
        }
    },
    server: {
        host: "0.0.0.0",
        port: 5173
    },
    test: {
        environment: "jsdom",
        setupFiles: ["./src/test/setup.ts"]
    }
});
