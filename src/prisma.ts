/** biome-ignore-all lint/correctness/noConstructorReturn: Fix */
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client.js";
import { env } from "./lib/env.js";
import { pgSearchExtension } from "./paginated-search.extension.js";

if (!env.DATABASE_URL) {
	throw new Error("DATABASE_URL não definida");
}

const adapter = new PrismaPg({
	connectionString: env.DATABASE_URL,
});

export const prisma = new PrismaClient({ adapter }).$extends(
	pgSearchExtension({
		debug: env.DEBUG_PG_SEARCH_EXTENSION,
		defaultPageSize: 20,
		maxPageSize: 100,
	}),
);

export type ExtendedPrismaClient = typeof prisma;
