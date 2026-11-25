import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config();
dotenv.config({ path: path.resolve(__dirname, '../.env') });
dotenv.config({ path: path.resolve(__dirname, '../../.env.local') });
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

export const config = {
  supabaseUrl: process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  supabaseAnonKey: process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '',
  supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || '',
  opencodeApiKey: process.env.OPENCODE_API_KEY || process.env.OPENAI_API_KEY || '',
  opencodeBaseUrl: process.env.OPENCODE_BASE_URL || 'https://opencode.ai/zen/go/v1',
  opencodeModel: process.env.OPENCODE_MODEL || 'qwen3.8-flash',
  opencodeVisionModel: process.env.OPENCODE_VISION_MODEL || 'deepseek-v4.1-flash',
  groqApiKey: process.env.GROQ_API_KEY || '',
  groqWhisperModel: process.env.GROQ_WHISPER_MODEL || 'whisper-large-v3-turbo',
  workshopName: process.env.WORKSHOP_NAME || 'Benittes Oficina Mecânica',
  publicSiteUrl: process.env.PUBLIC_SITE_URL || process.env.SITE_URL || '',
};

export function getMissingRuntimeConfig() {
  const missing = [];
  if (!config.supabaseUrl) missing.push('SUPABASE_URL');
  if (!config.supabaseServiceRoleKey) missing.push('SUPABASE_SERVICE_ROLE_KEY');
  return missing;
}

export function assertRuntimeConfig() {
  const missing = getMissingRuntimeConfig();
  if (missing.length > 0) {
    throw new Error(`Configuração obrigatória ausente: ${missing.join(', ')}`);
  }
  return config;
}

export default config;
