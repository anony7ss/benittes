import tseslint from "typescript-eslint";

export default [
  { ignores: [".next/**", "out/**", "dist/**", ".vercel/**", "node_modules/**", "bot-whatsapp/**"] },
  ...tseslint.configs.recommended,
];
