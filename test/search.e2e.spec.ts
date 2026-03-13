import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../src/prisma";
import { makeUser } from "./factories/make-user";

describe("Search E2E", () => {
	beforeAll(async () => {
		await prisma.$connect();
	});

	beforeEach(async () => {
		await prisma.user.deleteMany();
	});

	afterAll(async () => {
		await prisma.user.deleteMany();
		await prisma.$disconnect();
	});

	describe("Basic Search", () => {
		it("should return users matching the search query", async () => {
			await prisma.user.createMany({
				data: [
					makeUser({ name: "John Doe", email: "john@example.com" }),
					makeUser({ name: "Jane Smith", email: "jane@example.com" }),
					makeUser({ name: "Bob Wilson", email: "bob@example.com" }),
				],
			});

			const result = await prisma.user.search({
				search: { query: "John", perPage: 10 },
			});

			expect(result.data).toHaveLength(1);
			expect(result.data[0].name).toBe("John Doe");
			expect(result.total).toBe(1);
			expect(result.page).toBe(1);
			expect(result.hasNext).toBe(false);
		});

		it("should search users by email", async () => {
			await prisma.user.createMany({
				data: [
					makeUser({ name: "User One", email: "unique@example.com" }),
					makeUser({ name: "User Two", email: "other@example.com" }),
				],
			});

			const result = await prisma.user.search({
				search: { query: "unique@example.com", perPage: 10 },
			});

			expect(result.data).toHaveLength(1);
			expect(result.data[0].email).toBe("unique@example.com");
		});

		it("should return empty array when no users match", async () => {
			await prisma.user.create({
				data: makeUser({ name: "Test User" }),
			});

			const result = await prisma.user.search({
				search: { query: "NonExistent", perPage: 10 },
			});

			expect(result.data).toHaveLength(0);
			expect(result.total).toBe(0);
		});

		it("should return all users when search query is omitted", async () => {
			await prisma.user.createMany({
				data: [
					makeUser({ name: "Alpha", email: "alpha@example.com" }),
					makeUser({ name: "Beta", email: "beta@example.com" }),
					makeUser({ name: "Gamma", email: "gamma@example.com" }),
				],
			});

			const result = await prisma.user.search({
				search: { perPage: 10 },
			});

			expect(result.data).toHaveLength(3);
			expect(result.total).toBe(3);
		});

		it("should trim surrounding whitespace from query", async () => {
			await prisma.user.create({
				data: makeUser({
					name: "John Doe",
					email: "john@example.com",
				}),
			});

			const result = await prisma.user.search({
				search: { query: "   John   ", perPage: 10 },
			});

			expect(result.data).toHaveLength(1);
			expect(result.data[0].name).toBe("John Doe");
		});
	});

	describe("Casing / Case Insensitivity", () => {
		it("should match name regardless of query casing", async () => {
			await prisma.user.create({
				data: makeUser({
					name: "John Doe",
					email: "john@example.com",
				}),
			});

			const lower = await prisma.user.search({
				search: { query: "john", perPage: 10 },
			});

			const upper = await prisma.user.search({
				search: { query: "JOHN", perPage: 10 },
			});

			const mixed = await prisma.user.search({
				search: { query: "JoHn", perPage: 10 },
			});

			expect(lower.data).toHaveLength(1);
			expect(upper.data).toHaveLength(1);
			expect(mixed.data).toHaveLength(1);

			expect(lower.data[0].name).toBe("John Doe");
			expect(upper.data[0].name).toBe("John Doe");
			expect(mixed.data[0].name).toBe("John Doe");
		});

		it("should match email regardless of query casing", async () => {
			await prisma.user.create({
				data: makeUser({
					name: "User One",
					email: "CaseSensitive@example.com",
				}),
			});

			const result = await prisma.user.search({
				search: { query: "casesensitive@example.com", perPage: 10 },
			});

			expect(result.data).toHaveLength(1);
			expect(result.data[0].email).toBe("CaseSensitive@example.com");
		});

		it("should autocomplete regardless of prefix casing", async () => {
			await prisma.user.createMany({
				data: [
					makeUser({
						name: "Alexander",
						email: "alexander@example.com",
					}),
					makeUser({
						name: "Alexandra",
						email: "alexandra@example.com",
					}),
					makeUser({
						name: "Alexei",
						email: "alexei@example.com",
					}),
				],
			});

			const lower = await prisma.user.autocomplete("alex", {
				field: "name",
				limit: 10,
			});

			const upper = await prisma.user.autocomplete("ALEX", {
				field: "name",
				limit: 10,
			});

			expect(lower.length).toBeGreaterThanOrEqual(3);
			expect(upper.length).toBeGreaterThanOrEqual(3);
		});
	});

	describe("Pagination", () => {
		it("should paginate results correctly", async () => {
			await prisma.user.createMany({
				data: Array.from({ length: 25 }, (_, i) =>
					makeUser({
						name: `Test User ${i}`,
						email: `test-user-${i}@example.com`,
					}),
				),
			});

			const page1 = await prisma.user.search({
				search: { query: "Test", page: 1, perPage: 10 },
			});

			expect(page1.data).toHaveLength(10);
			expect(page1.total).toBe(25);
			expect(page1.totalPages).toBe(3);
			expect(page1.hasNext).toBe(true);
			expect(page1.hasPrev).toBe(false);

			const page2 = await prisma.user.search({
				search: { query: "Test", page: 2, perPage: 10 },
			});

			expect(page2.data).toHaveLength(10);
			expect(page2.hasNext).toBe(true);
			expect(page2.hasPrev).toBe(true);

			const page3 = await prisma.user.search({
				search: { query: "Test", page: 3, perPage: 10 },
			});

			expect(page3.data).toHaveLength(5);
			expect(page3.hasNext).toBe(false);
			expect(page3.hasPrev).toBe(true);
		});

		it("should return empty data for page beyond total pages", async () => {
			await prisma.user.createMany({
				data: Array.from({ length: 3 }, (_, i) =>
					makeUser({
						name: `Edge User ${i}`,
						email: `edge-user-${i}@example.com`,
					}),
				),
			});

			const result = await prisma.user.search({
				search: { query: "Edge", page: 2, perPage: 10 },
			});

			expect(result.data).toHaveLength(0);
			expect(result.total).toBe(3);
			expect(result.totalPages).toBe(1);
			expect(result.hasNext).toBe(false);
			expect(result.hasPrev).toBe(true);
		});

		it("should respect perPage for small values", async () => {
			await prisma.user.createMany({
				data: Array.from({ length: 5 }, (_, i) =>
					makeUser({
						name: `Small Page ${i}`,
						email: `small-page-${i}@example.com`,
					}),
				),
			});

			const result = await prisma.user.search({
				search: { query: "Small", page: 1, perPage: 2 },
			});

			expect(result.data).toHaveLength(2);
			expect(result.total).toBe(5);
			expect(result.totalPages).toBe(3);
		});
	});

	describe("Prisma Integration", () => {
		it("should apply where clause", async () => {
			await prisma.user.createMany({
				data: [
					makeUser({
						name: "Admin User",
						email: "admin@example.com",
						role: "admin",
					}),
					makeUser({
						name: "Normal User",
						email: "user@example.com",
						role: "user",
					}),
				],
			});

			const result = await prisma.user.search({
				search: { perPage: 10 },
				where: { role: "admin" },
			});

			expect(result.data).toHaveLength(1);
			expect(result.data[0].role).toBe("admin");
		});

		it("should apply orderBy", async () => {
			await prisma.user.createMany({
				data: [
					makeUser({ name: "Zack", email: "zack@example.com" }),
					makeUser({ name: "Alice", email: "alice@example.com" }),
					makeUser({ name: "Mike", email: "mike@example.com" }),
				],
			});

			const result = await prisma.user.search({
				search: { perPage: 10 },
				orderBy: { name: "asc" },
			});

			expect(result.data[0].name).toBe("Alice");
			expect(result.data[1].name).toBe("Mike");
			expect(result.data[2].name).toBe("Zack");
		});

		it("should support select", async () => {
			await prisma.user.create({
				data: makeUser({
					name: "Test User",
					email: "test@example.com",
				}),
			});

			const result = await prisma.user.search({
				search: { query: "Test" },
				select: { id: true, name: true },
			});

			expect(result.data).toHaveLength(1);
			expect(result.data[0]).toHaveProperty("id");
			expect(result.data[0]).toHaveProperty("name");
			expect(result.data[0]).not.toHaveProperty("email");
		});

		it("should support where with in operator", async () => {
			await prisma.user.createMany({
				data: [
					makeUser({
						name: "Admin A",
						email: "admin-a@example.com",
						role: "admin",
					}),
					makeUser({
						name: "Manager B",
						email: "manager-b@example.com",
						role: "manager",
					}),
					makeUser({
						name: "User C",
						email: "user-c@example.com",
						role: "user",
					}),
				],
			});

			const result = await prisma.user.search({
				search: { perPage: 10 },
				where: {
					role: {
						in: ["admin", "manager"],
					},
				},
			});

			expect(result.data).toHaveLength(2);
			expect(result.data.map((user) => user.role).sort()).toEqual([
				"admin",
				"manager",
			]);
		});

		it("should support where with not operator", async () => {
			await prisma.user.createMany({
				data: [
					makeUser({
						name: "Admin A",
						email: "admin-a@example.com",
						role: "admin",
					}),
					makeUser({
						name: "User B",
						email: "user-b@example.com",
						role: "user",
					}),
				],
			});

			const result = await prisma.user.search({
				search: { perPage: 10 },
				where: {
					role: {
						not: "admin",
					},
				},
			});

			expect(result.data).toHaveLength(1);
			expect(result.data[0].role).toBe("user");
		});
	});

	describe("Search Modes / Ranking", () => {
		it("should use fuzzy search", async () => {
			await prisma.user.create({
				data: makeUser({
					name: "Jonathan",
					email: "jonathan@example.com",
				}),
			});

			const result = await prisma.user.search({
				search: {
					query: "Jonathn",
					fuzzy: { distance: 2 },
					perPage: 10,
				},
			});

			expect(result.data.length).toBeGreaterThanOrEqual(1);
		});

		it("should return search scores", async () => {
			await prisma.user.createMany({
				data: [
					makeUser({
						name: "John Johnson",
						email: "john-johnson@example.com",
					}),
					makeUser({
						name: "John Doe",
						email: "john-doe@example.com",
					}),
				],
			});

			const result = await prisma.user.search({
				search: { query: "John", perPage: 10 },
			});

			expect(result.data).toHaveLength(2);
			expect(result.scores).toBeDefined();
			expect(result.scores?.size).toBe(2);
		});

		it("should search only in selected fields", async () => {
			await prisma.user.createMany({
				data: [
					makeUser({
						name: "Completely Different",
						email: "focus@example.com",
					}),
					makeUser({
						name: "Focus Name",
						email: "other@example.com",
					}),
				],
			});

			const byNameOnly = await prisma.user.search({
				search: {
					query: "focus",
					fields: ["name"],
					perPage: 10,
				},
			});

			const byEmailOnly = await prisma.user.search({
				search: {
					query: "focus",
					fields: ["email"],
					perPage: 10,
				},
			});

			expect(byNameOnly.data).toHaveLength(1);
			expect(byNameOnly.data[0].name).toBe("Focus Name");

			expect(byEmailOnly.data).toHaveLength(1);
			expect(byEmailOnly.data[0].email).toBe("focus@example.com");
		});

		it("should allow field boosts to affect ranking", async () => {
			await prisma.user.createMany({
				data: [
					makeUser({
						name: "Alpha Person",
						email: "zzz@example.com",
					}),
					makeUser({
						name: "Different Person",
						email: "alpha@example.com",
					}),
				],
			});

			const nameBoosted = await prisma.user.search({
				search: {
					query: "alpha",
					boosts: {
						name: 10,
						email: 1,
					},
					perPage: 10,
				},
			});

			expect(nameBoosted.data).toHaveLength(2);
			expect(nameBoosted.data[0].name).toBe("Alpha Person");
		});

		it("should support phrase mode", async () => {
			await prisma.user.createMany({
				data: [
					makeUser({
						name: "John Michael Doe",
						email: "john-michael@example.com",
					}),
					makeUser({
						name: "John Doe",
						email: "john-doe@example.com",
					}),
				],
			});

			const result = await prisma.user.search({
				search: {
					query: "John Doe",
					mode: "phrase",
					perPage: 10,
				},
			});

			expect(result.data.length).toBeGreaterThanOrEqual(1);
		});

		it("should return deterministic results with orderBy when query is omitted", async () => {
			await prisma.user.createMany({
				data: [
					makeUser({ name: "Charlie", email: "charlie@example.com" }),
					makeUser({ name: "Alice", email: "alice@example.com" }),
					makeUser({ name: "Bob", email: "bob@example.com" }),
				],
			});

			const result = await prisma.user.search({
				search: { perPage: 10 },
				orderBy: { name: "asc" },
			});

			expect(result.data.map((u) => u.name)).toEqual([
				"Alice",
				"Bob",
				"Charlie",
			]);
		});
	});

	describe("Flags / Metadata", () => {
		it("should support countTotal false", async () => {
			await prisma.user.createMany({
				data: [
					makeUser({ name: "Count A", email: "count-a@example.com" }),
					makeUser({ name: "Count B", email: "count-b@example.com" }),
				],
			});

			const result = await prisma.user.search({
				search: {
					query: "Count",
					perPage: 10,
					countTotal: false,
				},
			});

			expect(result.data).toHaveLength(2);
			expect(result.total).toBe(2);
			expect(result.page).toBe(1);
		});

		it("should include took in response", async () => {
			await prisma.user.create({
				data: makeUser({
					name: "Timing User",
					email: "timing@example.com",
				}),
			});

			const result = await prisma.user.search({
				search: { query: "Timing", perPage: 10 },
			});

			expect(typeof result.took).toBe("number");
			expect(result.took).toBeGreaterThanOrEqual(0);
		});
	});

	describe("Autocomplete", () => {
		it("should return autocomplete suggestions", async () => {
			await prisma.user.createMany({
				data: [
					makeUser({
						name: "Alexander",
						email: "alexander@example.com",
					}),
					makeUser({
						name: "Alexandra",
						email: "alexandra@example.com",
					}),
					makeUser({
						name: "Alexei",
						email: "alexei@example.com",
					}),
				],
			});

			const suggestions = await prisma.user.autocomplete("Alex", {
				field: "name",
				limit: 10,
			});

			expect(suggestions.length).toBeGreaterThanOrEqual(3);
			expect(suggestions.every((s) => s.toLowerCase().startsWith("alex"))).toBe(
				true,
			);
		});

		it("should respect autocomplete limit", async () => {
			await prisma.user.createMany({
				data: [
					makeUser({ name: "Alex A", email: "alex-a@example.com" }),
					makeUser({ name: "Alex B", email: "alex-b@example.com" }),
					makeUser({ name: "Alex C", email: "alex-c@example.com" }),
				],
			});

			const suggestions = await prisma.user.autocomplete("Alex", {
				field: "name",
				limit: 2,
			});

			expect(suggestions).toHaveLength(2);
		});

		it("should return empty array for blank autocomplete prefix", async () => {
			const suggestions = await prisma.user.autocomplete("   ", {
				field: "name",
				limit: 10,
			});

			expect(suggestions).toEqual([]);
		});
	});
});
