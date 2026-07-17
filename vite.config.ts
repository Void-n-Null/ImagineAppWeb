import tailwindcss from '@tailwindcss/vite'
import { devtools } from '@tanstack/devtools-vite'

import { tanstackStart } from '@tanstack/react-start/plugin/vite'

import viteReact from '@vitejs/plugin-react'
import { nitro } from 'nitro/vite'
import { defineConfig } from 'vite'

const config = defineConfig({
  resolve: { tsconfigPaths: true },
  server: {
    // Phone testing via a tunnel (e.g. `tailscale serve --bg 3000`):
    // set DEV_ALLOWED_HOST to the tunnel hostname.
    allowedHosts: process.env.DEV_ALLOWED_HOST
      ? [process.env.DEV_ALLOWED_HOST]
      : [],
  },
  plugins: [
    devtools(),
    tailwindcss(),
    tanstackStart({
      spa: {
        enabled: true,
      },
    }),
    // maxDuration 300 (Hobby/fluid ceiling): agent turns run 60-120s of
    // model calls + tool chains (IMA-17); the default would cut them off.
    nitro({ vercel: { functions: { maxDuration: 300 } } }),
    viteReact(),
  ],
})

export default config
