// middleware/validate.js — zod-based request validation helpers.

import { z } from 'zod';

export const loginBody = z.object({
  loginId: z.string().min(3).max(64).regex(/^[a-zA-Z0-9._@-]+$/, 'bad_id').transform(s => s.toLowerCase().trim()),
  password: z.string().min(1).max(200),
});

export const createUserBody = z.object({
  loginId: z.string().min(3).max(64).regex(/^[a-zA-Z0-9._@-]+$/, 'bad_id').transform(s => s.toLowerCase().trim()),
  password: z.string().min(12).max(200),
  role: z.enum(['admin', 'editor']).default('editor'),
});

export const trackBody = z.object({
  buttonId: z.string().min(1).max(64),
  label: z.string().max(80).optional(),
});

// Config PATCH body — accepts any subset of fields.
export const configBody = z.object({
  appName: z.string().max(120).optional(),
  tagline: z.string().max(200).optional(),
  theme: z.enum(['cream','sage','midnight','sunset']).optional(),
  banners: z.array(z.object({
    id: z.string().max(64).optional(),
    title: z.string().max(120).optional(),
    subtitle: z.string().max(200).optional(),
    tone: z.enum(['leaf','sun','clay','sky','plum']).optional(),
  })).max(20).optional(),
  buttons: z.array(z.object({
    id: z.string().max(64).optional(),
    label: z.string().max(120).optional(),
    sub: z.string().max(200).optional(),
    icon: z.string().max(32).optional(),
    url: z.string().max(2048).optional(),
  })).max(12).optional(),
  contact: z.object({
    label: z.string().max(120).optional(),
    channel: z.enum(['line','messenger','whatsapp','phone','email']).optional(),
    value: z.string().max(200).optional(),
  }).optional(),
}).strict();   // reject unknown keys

export function validate(schema, source = 'body') {
  return (req, res, next) => {
    const parsed = schema.safeParse(req[source]);
    if (!parsed.success) {
      return res.status(400).json({
        error: 'invalid_input',
        issues: parsed.error.issues.map(i => ({ path: i.path.join('.'), msg: i.message })),
      });
    }
    req[source] = parsed.data;
    next();
  };
}
