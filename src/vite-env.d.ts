/// <reference types="vite/client" />

// Vite ships a type for `*.wasm?init` but not `*.wasm?url`.
declare module '*.wasm?url' {
  const url: string
  export default url
}
