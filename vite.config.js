import { defineConfig } from 'vite';

export default defineConfig({
  
  server: {
    // Optional: Choose a port if 5173 is busy
    port: 3000, 
  },
  
  // This build block tells Vite how to handle the single HTML file if you decide to build it
  build: {
    rollupOptions: {
      input: {
        // Defines the entry point for the build as your main.html file
        main: 'main.html',
      },
    },
  },
});