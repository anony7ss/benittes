import { createClient } from '@supabase/supabase-js';
import config from './config.js';

const supabaseUrl = config.supabaseUrl || 'http://127.0.0.1:9';
const supabaseKey = config.supabaseServiceRoleKey || 'disabled-service-role-key';

export const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
});
