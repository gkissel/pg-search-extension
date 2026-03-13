import { faker } from "@faker-js/faker";
import type { Prisma } from "../../generated/prisma/client.js";

export type MakeUserInput = Partial<Prisma.UserUncheckedCreateInput>;

export function makeUser(
	overrides: MakeUserInput = {},
): Prisma.UserUncheckedCreateInput {
	const createdAt = overrides.createdAt ?? faker.date.recent({ days: 30 });

	return {
		id: overrides.id ?? faker.string.uuid(),
		name: overrides.name ?? faker.person.fullName(),
		email:
			overrides.email ??
			`user.${faker.string.alphanumeric(10).toLowerCase()}@example.com`,
		emailVerified: overrides.emailVerified ?? false,
		image: overrides.image ?? null,
		createdAt,
		updatedAt: overrides.updatedAt ?? createdAt,
		role: overrides.role ?? "user",
	};
}
