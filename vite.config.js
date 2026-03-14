import { defineConfig } from 'vite';

export default defineConfig({
    root: 'src',
    build: {
        outDir: '../www',
        emptyOutDir: true,
    },
    server: {
        port: 3000
    }
});