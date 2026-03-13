import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

export const env = createEnv({
    server: {
        DATABASE_URL: z.url().default("postgresql://postgres:docker@localhost:5432/app"),
    },
    runtimeEnv:{
        DATABASE_URL: process.env.DATABASE_URL,
    },
    emptyStringAsUndefined: true,
});