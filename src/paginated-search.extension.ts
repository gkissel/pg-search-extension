// ============================================================================
// TYPES
// ============================================================================

import { Prisma } from "../generated/prisma/client.js";

type MatchMode = "any" | "all" | "phrase" | "exact" | "fuzzy";

type Tokenizer =
	| "unicode_words"
	| "literal"
	| "literal_normalized"
	| "whitespace"
	| "simple"
	| "icu"
	| { ngram: { min: number; max: number } };

interface FieldConfig {
	field: string;
	tokenizer?: Tokenizer;
	boost?: number;
	alias?: string;
}

interface JoinConfig {
	table: string;
	alias: string;
	on: string;
	fields: FieldConfig[];
	keyField?: string;
}

interface ModelSearchConfig {
	table: string;
	index: string;
	keyField: string;
	fields: FieldConfig[];
	joins?: JoinConfig[];
	defaultMode?: MatchMode;
}

/**
 * Search-specific parameters for ParadeDB full-text search
 */
interface SearchParams {
	/** The search query string */
	query?: string;
	/** Match mode: any (OR), all (AND), phrase, exact, fuzzy */
	mode?: MatchMode;
	/** Page number (1-indexed) */
	page?: number;
	/** Items per page */
	perPage?: number;
	/** Minimum score threshold */
	minScore?: number;
	/** Fields to search (defaults to all configured fields) */
	fields?: string[];
	/** Boost values per field */
	boosts?: Record<string, number>;
	/** Enable fuzzy search with optional distance */
	fuzzy?: boolean | { distance: number };
	/** Enable highlighting with optional config */
	highlight?: boolean | { tag?: string; maxChars?: number };
	/** Facet aggregation config */
	facets?: FacetConfig[];
	/** Whether to count total results */
	countTotal?: boolean;
}

/**
 * Combined arguments for the search method
 * Extends Prisma findMany args with full-text search capabilities
 */
type SearchArgs<
	T,
	A extends Prisma.Args<T, "findMany"> = Prisma.Args<T, "findMany">,
> = A & {
	/** Full-text search parameters */
	search?: SearchParams;
	/** Override orderBy for search results (defaults to search score desc) */
	orderBySearchScore?: boolean;
};

interface FacetConfig {
	field: string;
	type: "terms" | "range" | "stats";
	size?: number;
	ranges?: Array<{ from?: number; to?: number }>;
}

interface HighlightResult {
	snippet: string;
	field: string;
}

interface FacetBucket {
	key: string | number;
	count: number;
}

interface FacetResults {
	[field: string]: {
		buckets: FacetBucket[];
	};
}

/**
 * Result from the search method with full type safety
 */
interface SearchResult<T> {
	/** The matching records with proper Prisma types */
	data: T[];
	/** Total matching records */
	total: number;
	/** Total pages */
	totalPages: number;
	/** Current page (1-indexed) */
	page: number;
	/** Items per page */
	perPage: number;
	/** Whether there's a next page */
	hasNext: boolean;
	/** Whether there's a previous page */
	hasPrev: boolean;
	/** Search scores by record ID */
	scores?: Map<string, number>;
	/** Highlight snippets by record ID */
	highlights?: Map<string, HighlightResult[]>;
	/** Facet aggregation results */
	facets?: FacetResults;
	/** Query execution time in ms */
	took?: number;
}

interface DebugInfo {
	sql: string;
	params: unknown[];
	time: number;
	explain?: string;
}

// ============================================================================
// OPERATORS (v2 API)
// ============================================================================

const SearchOperators = {
	any: "OR",
	all: "AND",
	phrase: "",
	exact: "",
	fuzzy: "OR",
} as const;

// ============================================================================
// ESCAPE FUNCTIONS
// ============================================================================

/**
 * Escape string for use in Tantivy query parser
 * Only escapes characters that have special meaning in the query syntax
 */
function escapeTantivy(str: string): string {
	return str.replace(/([+\-&|!(){}[\]^"~*?:\\])/g, "\\$1");
}

function buildFieldSearchQuery(
	fieldName: string,
	query: string,
	boost: number,
	mode: MatchMode,
	fuzzyDistance?: number,
): string {
	const operator = SearchOperators[mode] || "OR";
	const terms = query.split(/\s+/).filter(Boolean);

	// Handle phrase mode - use exact phrase match
	if (mode === "phrase") {
		const escaped = escapeTantivy(query);
		return `(${fieldName}:"${escaped}")^${boost}`;
	}

	// Handle exact mode - use raw tokenizer field if available, otherwise exact match
	if (mode === "exact") {
		const escaped = escapeTantivy(query);
		return `(${fieldName}:${escaped})^${boost}`;
	}

	// Multi-term search with operator
	if (terms.length > 1) {
		const fieldTerms = terms
			.map((term) => {
				const escaped = escapeTantivy(term);
				return fuzzyDistance ? `${escaped}~${fuzzyDistance}` : escaped;
			})
			.join(` ${operator} `);
		return `(${fieldName}:(${fieldTerms}))^${boost}`;
	}

	// Single term
	const escapedTantivy = escapeTantivy(query);
	if (fuzzyDistance) {
		return `(${fieldName}:${escapedTantivy}~${fuzzyDistance})^${boost}`;
	}
	return `(${fieldName}:${escapedTantivy})^${boost}`;
}

// ============================================================================
// ERROR CLASS
// ============================================================================

class SearchError extends Error {
	constructor(message: string, options?: ErrorOptions) {
		super(message);
		this.name = "SearchError";
		if (options?.cause) {
			this.cause = options.cause;
		}
	}
}

// ============================================================================
// CONFIG REGISTRY
// ============================================================================

class SearchConfigRegistry {
	private configs = new Map<string, ModelSearchConfig>();

	register(modelName: string, config: ModelSearchConfig): void {
		this.configs.set(modelName.toLowerCase(), config);
	}

	get(modelName: string): ModelSearchConfig | undefined {
		return this.configs.get(modelName.toLowerCase());
	}

	has(modelName: string): boolean {
		return this.configs.has(modelName.toLowerCase());
	}
}

const searchConfigRegistry = new SearchConfigRegistry();

// ============================================================================
// MODEL CONFIGURATIONS
// ============================================================================

searchConfigRegistry.register("user", {
	table: "user",
	index: "user_search_idx",
	keyField: "id",
	fields: [
		{ field: "name", boost: 2.0 },
		{
			field: "name",
			tokenizer: { ngram: { min: 3, max: 4 } },
			alias: "name_ngram",
		},
		{ field: "email", boost: 1.5 },
	],
	defaultMode: "any",
});

// ============================================================================
// QUERY BUILDER
// ============================================================================

interface BuildQueryParams {
	query?: string;
	mode: MatchMode;
	offset: number;
	limit: number;
	orderBy?: string;
	order: "asc" | "desc";
	minScore?: number;
	searchFields?: string[];
	boosts?: Record<string, number>;
	fuzzy?: boolean | { distance: number };
	highlight?: boolean | { tag?: string; maxChars?: number };
	facets?: FacetConfig[];
	filter?: Record<string, unknown>;
	countTotal: boolean;
}

function buildQueries(
	config: ModelSearchConfig,
	params: BuildQueryParams,
): {
	dataQuery: { sql: string; params: unknown[] };
	countQuery?: { sql: string; params: unknown[] };
	facetQuery?: { sql: string; params: unknown[] };
} {
	const {
		query,
		mode,
		offset,
		limit,
		orderBy,
		order,
		minScore,
		searchFields,
		boosts,
		fuzzy,
		highlight,
		facets,
		filter,
		countTotal,
	} = params;

	const hasJoins = config.joins && config.joins.length > 0;
	const tableAlias = hasJoins ? "main" : undefined;
	const keyFieldRef = tableAlias
		? `${tableAlias}."${config.keyField}"`
		: `"${config.keyField}"`;

	// Determine fields to search
	const fieldsToSearch =
		searchFields ?? config.fields.map((f) => f.alias ?? f.field);
	const fieldConfigs = new Map(
		config.fields.map((f) => [f.alias ?? f.field, f]),
	);

	// Build search conditions using v2 operators
	const searchConditions: string[] = [];
	const scoreExpressions: string[] = [];

	// Normalize query early
	const trimmedQuery = query?.trim();
	const hasQuery = !!trimmedQuery;

	if (hasQuery) {
		const fuzzyDistance = fuzzy
			? typeof fuzzy === "object"
				? fuzzy.distance
				: 1
			: undefined;

		// Build condition for main table fields
		for (const fieldName of fieldsToSearch) {
			const fieldConfig = fieldConfigs.get(fieldName);
			const boost = boosts?.[fieldName] ?? fieldConfig?.boost ?? 1.0;

			const searchValue = buildFieldSearchQuery(
				fieldName,
				trimmedQuery,
				boost,
				mode,
				fuzzyDistance,
			);

			searchConditions.push(searchValue);
		}

		// Add score expression for main table only
		scoreExpressions.push(`COALESCE(paradedb.score(${keyFieldRef}), 0)`);
	}

	// Build filter conditions
	const filterConditions: string[] = [];
	const filterParams: unknown[] = [];

	if (filter) {
		for (const [key, value] of Object.entries(filter)) {
			if (value === undefined) continue;

			const fieldRef = key.includes(".")
				? key
				: tableAlias
					? `${tableAlias}."${key}"`
					: `"${key}"`;

			if (value === null) {
				filterConditions.push(`${fieldRef} IS NULL`);
			} else if (Array.isArray(value)) {
				if (value.length > 0) {
					const placeholders = value.map(
						(_, i) => `$${filterParams.length + i + 1}`,
					);
					filterConditions.push(`${fieldRef} IN (${placeholders.join(", ")})`);
					filterParams.push(...value);
				}
			} else if (typeof value === "object" && value !== null) {
				const opValue = value as Record<string, unknown>;

				if ("in" in opValue && Array.isArray(opValue.in)) {
					const placeholders = opValue.in.map(
						(_, i) => `$${filterParams.length + i + 1}`,
					);
					filterConditions.push(`${fieldRef} IN (${placeholders.join(", ")})`);
					filterParams.push(...opValue.in);
				} else if ("not" in opValue) {
					if (opValue.not === null) {
						filterConditions.push(`${fieldRef} IS NOT NULL`);
					} else {
						filterConditions.push(`${fieldRef} != $${filterParams.length + 1}`);
						filterParams.push(opValue.not);
					}
				} else if ("gt" in opValue) {
					filterConditions.push(`${fieldRef} > $${filterParams.length + 1}`);
					filterParams.push(opValue.gt);
				} else if ("gte" in opValue) {
					filterConditions.push(`${fieldRef} >= $${filterParams.length + 1}`);
					filterParams.push(opValue.gte);
				} else if ("lt" in opValue) {
					filterConditions.push(`${fieldRef} < $${filterParams.length + 1}`);
					filterParams.push(opValue.lt);
				} else if ("lte" in opValue) {
					filterConditions.push(`${fieldRef} <= $${filterParams.length + 1}`);
					filterParams.push(opValue.lte);
				} else {
					filterConditions.push(`${fieldRef} = $${filterParams.length + 1}`);
					filterParams.push(value);
				}
			} else {
				filterConditions.push(`${fieldRef} = $${filterParams.length + 1}`);
				filterParams.push(value);
			}
		}
	}

	// Build JOIN clauses
	const joinClauses =
		config.joins
			?.map((j) => {
				const onClause = j.on.replace(/main_tbl/g, "main");
				return `LEFT JOIN "${j.table}" ${j.alias} ON ${onClause}`;
			})
			.join("\n") ?? "";

	// Build SELECT clause
	const selectFields: string[] = [tableAlias ? `${tableAlias}.*` : "*"];

	// Add score calculation
	if (hasQuery && scoreExpressions.length > 0) {
		const combinedScore = scoreExpressions.join(" + ");
		selectFields.push(`(${combinedScore}) as __search_score`);
	}

	// Add highlights
	if (highlight && hasQuery) {
		const tag = typeof highlight === "object" ? highlight.tag : "b";
		const maxChars = typeof highlight === "object" ? highlight.maxChars : 150;
		const highlightFields = fieldsToSearch.slice(0, 3);

		const highlightExprs = highlightFields.map(
			(f) =>
				`paradedb.snippet("${f}", start_tag => '<${tag}>', end_tag => '</${tag}>', max_num_chars => ${maxChars})`,
		);

		selectFields.push(
			`json_build_array(${highlightExprs.map((h, i) => `json_build_object('snippet', ${h}, 'field', '${highlightFields[i]}')`).join(", ")}) as __highlights`,
		);
	}

	// Build WHERE clause
	const whereConditions: string[] = [];

	if (searchConditions.length > 0) {
		// Use paradedb.parse with proper Tantivy syntax
		const parseQuery = searchConditions.join(" OR ");
		whereConditions.push(
			`${keyFieldRef} @@@ paradedb.parse('${parseQuery}', true)`,
		);

		// For joins, we need separate conditions
		if (config.joins && config.joins.length > 0) {
			for (const join of config.joins) {
				const joinKeyRef = `${join.alias}."${join.keyField ?? "id"}"`;
				const joinConditions: string[] = [];

				for (const field of join.fields) {
					const boost = boosts?.[field.field] ?? field.boost ?? 1.0;
					const fuzzyDistance = fuzzy
						? typeof fuzzy === "object"
							? fuzzy.distance
							: 1
						: undefined;

					const searchValue = buildFieldSearchQuery(
						field.field,
						trimmedQuery!,
						boost,
						mode,
						fuzzyDistance,
					);

					joinConditions.push(searchValue);
				}

				if (joinConditions.length > 0) {
					const joinParseQuery = joinConditions.join(" OR ");
					whereConditions.push(
						`${joinKeyRef} @@@ paradedb.parse('${joinParseQuery}', true)`,
					);
				}
			}
		}
	}

	if (filterConditions.length > 0) {
		whereConditions.push(...filterConditions);
	}

	if (minScore !== undefined && hasQuery && scoreExpressions.length > 0) {
		whereConditions.push(`(${scoreExpressions.join(" + ")}) >= ${minScore}`);
	}

	// Build ORDER BY clause
	const orderField = orderBy ?? config.keyField;
	const orderRef = orderField.includes(".")
		? orderField
		: tableAlias
			? `${tableAlias}."${orderField}"`
			: `"${orderField}"`;

	const orderByParts: string[] = [];

	if (hasQuery) {
		orderByParts.push("__search_score DESC");
	}
	orderByParts.push(`${orderRef} ${order.toUpperCase()}`);

	// Build final query parts
	const fromClause = tableAlias
		? `"${config.table}" ${tableAlias}`
		: `"${config.table}"`;
	const whereClause =
		whereConditions.length > 0 ? `WHERE ${whereConditions.join(" AND ")}` : "";
	const queryParams: unknown[] = [...filterParams];

	// Main data query - for joins, use UNION ALL to avoid subquery issues with @@@
	let dataSql: string;

	if (hasJoins && hasQuery) {
		// For joins with search, use UNION ALL to combine results from each source
		// This avoids the "Unsupported query shape" error when using @@@ in subqueries
		const fuzzyDistance = fuzzy
			? typeof fuzzy === "object"
				? fuzzy.distance
				: 1
			: undefined;

		// Build main table search condition
		const mainConditions = fieldsToSearch.map((fieldName) => {
			const fieldConfig = fieldConfigs.get(fieldName);
			const boost = boosts?.[fieldName] ?? fieldConfig?.boost ?? 1.0;
			return buildFieldSearchQuery(
				fieldName,
				trimmedQuery!,
				boost,
				mode,
				fuzzyDistance,
			);
		});

		const mainParseQuery = mainConditions.join(" OR ");

		// Build union queries for each source - each returns (id, score, source_priority)
		const unionQueries: string[] = [];
		const filterStr =
			filterConditions.length > 0
				? ` AND ${filterConditions.join(" AND ")}`
				: "";

		// Main table query - return matching IDs with scores
		unionQueries.push(`
			SELECT ${keyFieldRef} as "${config.keyField}",
				   COALESCE(paradedb.score(${keyFieldRef}), 0) as __search_score,
				   1 as __source_priority
			FROM ${fromClause}
			WHERE ${keyFieldRef} @@@ paradedb.parse('${mainParseQuery}', true)${filterStr}
		`);

		// Join table queries - return matching IDs from main table via join
		for (const join of config.joins ?? []) {
			const joinConditions = join.fields.map((field) => {
				const boost = boosts?.[field.field] ?? field.boost ?? 1.0;
				return buildFieldSearchQuery(
					field.field,
					trimmedQuery!,
					boost,
					mode,
					fuzzyDistance,
				);
			});

			const joinParseQuery = joinConditions.join(" OR ");

			// Parse the join ON clause to extract the foreign key relationship
			const fkMatch = join.on.match(/main\."(\w+)"\s*=\s*(\w+)\."id"/);
			const fkColumn = fkMatch?.[1];

			if (fkColumn) {
				unionQueries.push(`
					SELECT ${tableAlias ?? "main"}."${config.keyField}" as "${config.keyField}",
						   0 as __search_score,
						   2 as __source_priority
					FROM ${fromClause}
					INNER JOIN "${join.table}" ${join.alias} ON ${tableAlias ?? "main"}."${fkColumn}" = ${join.alias}."id"
					WHERE ${join.alias}."id" @@@ paradedb.parse('${joinParseQuery}', true)${filterStr}
				`);
			}
		}

		// Combine matching IDs, deduplicate, then fetch full data with scores
		dataSql = `
			WITH matching_ids AS (
				SELECT DISTINCT ON ("${config.keyField}") "${config.keyField}", __search_score, __source_priority
				FROM (
					${unionQueries.join("\n UNION ALL \n")}
				) combined
				ORDER BY "${config.keyField}", __search_score DESC, __source_priority ASC
			)
			SELECT m.*, COALESCE(i.__search_score, 0) as __search_score
			FROM matching_ids i
			INNER JOIN "${config.table}" m ON m."${config.keyField}" = i."${config.keyField}"
			ORDER BY i.__search_score DESC, m."${config.keyField}" DESC
			LIMIT ${limit}
			OFFSET ${offset}
		`.trim();
	} else {
		dataSql = `
			SELECT ${selectFields.join(", ")}
			FROM ${fromClause}
			${joinClauses}
			${whereClause}
			ORDER BY ${orderByParts.join(", ")}
			LIMIT ${limit}
			OFFSET ${offset}
		`.trim();
	}

	// Count query
	let countSql: string | undefined;
	if (countTotal) {
		if (hasJoins && hasQuery) {
			const fuzzyDistance = fuzzy
				? typeof fuzzy === "object"
					? fuzzy.distance
					: 1
				: undefined;

			// Build main table search condition
			const mainConditions = fieldsToSearch.map((fieldName) => {
				const fieldConfig = fieldConfigs.get(fieldName);
				const boost = boosts?.[fieldName] ?? fieldConfig?.boost ?? 1.0;
				return buildFieldSearchQuery(
					fieldName,
					trimmedQuery!,
					boost,
					mode,
					fuzzyDistance,
				);
			});

			const mainParseQuery = mainConditions.join(" OR ");

			// Build union queries for counting - each returns just the ID
			const unionQueries: string[] = [];
			const filterStr =
				filterConditions.length > 0
					? ` AND ${filterConditions.join(" AND ")}`
					: "";

			// Main table query
			unionQueries.push(`
				SELECT ${keyFieldRef} as "${config.keyField}"
				FROM ${fromClause}
				WHERE ${keyFieldRef} @@@ paradedb.parse('${mainParseQuery}', true)${filterStr}
			`);

			// Join table queries
			for (const join of config.joins ?? []) {
				const joinConditions = join.fields.map((field) => {
					const boost = boosts?.[field.field] ?? field.boost ?? 1.0;
					return buildFieldSearchQuery(
						field.field,
						trimmedQuery!,
						boost,
						mode,
						fuzzyDistance,
					);
				});

				const joinParseQuery = joinConditions.join(" OR ");

				// Parse the join ON clause to extract the foreign key relationship
				const fkMatch = join.on.match(/main\."(\w+)"\s*=\s*(\w+)\."id"/);
				const fkColumn = fkMatch?.[1];

				if (fkColumn) {
					unionQueries.push(`
						SELECT ${tableAlias ?? "main"}."${config.keyField}" as "${config.keyField}"
						FROM ${fromClause}
						INNER JOIN "${join.table}" ${join.alias} ON ${tableAlias ?? "main"}."${fkColumn}" = ${join.alias}."id"
						WHERE ${join.alias}."id" @@@ paradedb.parse('${joinParseQuery}', true)${filterStr}
					`);
				}
			}

			// Count distinct IDs from union
			countSql = `
				SELECT COUNT(DISTINCT "${config.keyField}") as total
				FROM (
					${unionQueries.join("\n UNION ALL \n")}
				) combined
			`.trim();
		} else {
			countSql = `
				SELECT COUNT(*) as total
				FROM ${fromClause}
				${joinClauses}
				${whereClause}
			`.trim();
		}
	}

	// Facet query
	let facetSql: string | undefined;
	if (facets && facets.length > 0 && hasQuery) {
		const facetExprs = facets.map((f) => {
			if (f.type === "terms") {
				return `'${f.field}': ${JSON.stringify({
					terms: { field: f.field, size: f.size ?? 10 },
				})}`;
			}
			if (f.type === "range" && f.ranges) {
				return `'${f.field}': ${JSON.stringify({
					range: { field: f.field, ranges: f.ranges },
				})}`;
			}
			return `'${f.field}': ${JSON.stringify({ stats: { field: f.field } })}`;
		});

		facetSql = `
			SELECT json_build_object(${facetExprs.join(", ")}) as facets
			FROM ${fromClause}
			${joinClauses}
			${whereClause}
		`.trim();
	}

	return {
		dataQuery: { sql: dataSql, params: queryParams },
		countQuery: countSql ? { sql: countSql, params: queryParams } : undefined,
		facetQuery: facetSql ? { sql: facetSql, params: queryParams } : undefined,
	};
}

// ============================================================================
// EXTENSION OPTIONS
// ============================================================================

interface PgSearchExtensionOptions {
	debug?: boolean;
	defaultPageSize?: number;
	maxPageSize?: number;
}

// ============================================================================
// HELPER TO EXTRACT WHERE FILTER FOR PARADEDB
// ============================================================================

function extractScalarWhere(where: unknown): Record<string, unknown> {
	if (!where || typeof where !== "object") return {};

	const result: Record<string, unknown> = {};
	const whereObj = where as Record<string, unknown>;

	// Extract only scalar fields (not relations or operators like AND/OR/NOT)
	for (const [key, value] of Object.entries(whereObj)) {
		// Skip Prisma operators and relation fields
		if (["AND", "OR", "NOT"].includes(key)) continue;
		if (typeof value === "object" && value !== null && !Array.isArray(value)) {
			// Check if it's a Prisma operator object or a relation
			const keys = Object.keys(value as Record<string, unknown>);
			const isOperatorObj = keys.some((k) =>
				[
					"in",
					"notIn",
					"not",
					"gt",
					"gte",
					"lt",
					"lte",
					"equals",
					"contains",
					"startsWith",
					"endsWith",
					"mode",
					"isSet",
				].includes(k),
			);
			if (isOperatorObj) {
				result[key] = value;
			}
			// Skip relation objects
		} else if (value !== undefined) {
			result[key] = value;
		}
	}

	return result;
}

// ============================================================================
// MAIN EXTENSION
// ============================================================================

function pgSearchExtension(options: PgSearchExtensionOptions = {}) {
	const debug = options.debug ?? false;
	const defaultPageSize = options.defaultPageSize ?? 20;
	const maxPageSize = options.maxPageSize ?? 100;

	return Prisma.defineExtension((client) => {
		return client.$extends({
			name: "pg-search-extension-v2",
			model: {
				$allModels: {
					/**
					 * Perform a full-text search with ParadeDB and return properly typed results
					 * with support for include, select, where, and orderBy from Prisma.
					 *
					 * @example
					 * ```ts
					 * // Simple search
					 * const result = await prisma.user.search({ search: { query: 'john' } });
					 *
					 * // With include
					 * const result = await prisma.user.search({
					 *   search: { query: 'john' },
					 *   include: { sessions: true }
					 * });
					 *
					 * // With where filter combined with search
					 * const result = await prisma.user.search({
					 *   search: { query: 'john' },
					 *   where: { role: 'admin' }
					 * });
					 *
					 * // With select and orderBy
					 * const result = await prisma.user.search({
					 *   search: { query: 'john', fuzzy: true },
					 *   select: { id: true, name: true, email: true },
					 *   orderBy: { createdAt: 'desc' }
					 * });
					 * ```
					 */
					async search<T, A extends SearchArgs<T>>(
						this: T,
						args?: A,
					): Promise<SearchResult<Prisma.Result<T, A, "findMany">[number]>> {
						const startTime = Date.now();
						const context = Prisma.getExtensionContext(this);
						const modelName = context.$name;

						if (!modelName) {
							throw new SearchError("Could not determine model name");
						}

						const config = searchConfigRegistry.get(modelName);
						if (!config) {
							throw new SearchError(
								`No search configuration registered for model: ${modelName}. Register it with searchConfigRegistry.register('${modelName.toLowerCase()}', {...})`,
							);
						}

						// Extract search params and Prisma args
						const {
							search: searchParams,
							orderBySearchScore = true,
							where: prismaWhere,
							orderBy: prismaOrderBy,
							include,
							select,
							...restArgs
						} = (args ?? {}) as SearchArgs<T> & {
							search?: SearchParams;
							orderBySearchScore?: boolean;
						};

						const {
							query,
							mode = config.defaultMode ?? "any",
							page = 1,
							perPage = defaultPageSize,
							minScore,
							fields: searchFields,
							boosts,
							fuzzy,
							highlight,
							facets,
							countTotal = true,
						} = searchParams ?? {};

						const limitPerPage = Math.min(perPage, maxPageSize);
						const offset = (page - 1) * limitPerPage;

						if (debug) {
							console.log(`[Search] ${modelName}`, {
								query,
								mode,
								page,
								perPage,
								hasInclude: !!include,
								hasSelect: !!select,
								hasWhere: !!prismaWhere,
							});
						}

						try {
							// Extract scalar where conditions for ParadeDB pre-filtering
							const scalarWhere = extractScalarWhere(prismaWhere);

							const { dataQuery, countQuery, facetQuery } = buildQueries(
								config,
								{
									query,
									mode,
									offset,
									limit: limitPerPage,
									orderBy: undefined,
									order: "desc",
									minScore,
									searchFields,
									boosts,
									fuzzy,
									highlight,
									facets,
									filter: scalarWhere,
									countTotal,
								},
							);

							if (debug) {
								console.log("[Search] Data Query:", dataQuery.sql);
								console.log("[Search] Params:", dataQuery.params);
							}

							// Execute ParadeDB query to get matching IDs
							const queries: Promise<unknown>[] = [
								client.$queryRawUnsafe<Record<string, unknown>[]>(
									dataQuery.sql,
									...dataQuery.params,
								),
							];

							if (countTotal && countQuery) {
								queries.push(
									client.$queryRawUnsafe<{ total: bigint }[]>(
										countQuery.sql,
										...countQuery.params,
									),
								);
							}

							if (facetQuery) {
								queries.push(
									client.$queryRawUnsafe<{ facets: string }[]>(
										facetQuery.sql,
										...facetQuery.params,
									),
								);
							}

							const results = await Promise.all(queries);

							const paradeDbData = results[0] as Record<string, unknown>[];
							const totalResult = countTotal
								? (results[1] as { total: bigint }[] | undefined)
								: undefined;
							const facetResult = facetQuery
								? (results[countTotal ? 2 : 1] as
										| { facets: string }[]
										| undefined)
								: undefined;

							const total = totalResult
								? Number(totalResult[0]?.total ?? 0)
								: paradeDbData.length;
							const totalPages = Math.ceil(total / limitPerPage);

							// Extract IDs and scores from ParadeDB results
							const scores = new Map<string, number>();
							const highlights = new Map<string, HighlightResult[]>();
							const matchingIds: string[] = [];

							for (const row of paradeDbData) {
								const { __search_score, __highlights, ...cleanRow } = row;
								const id = String(cleanRow[config.keyField]);
								matchingIds.push(id);

								if (__search_score !== undefined) {
									scores.set(id, Number(__search_score));
								}

								if (__highlights) {
									try {
										highlights.set(
											id,
											JSON.parse(String(__highlights)) as HighlightResult[],
										);
									} catch {
										// ignore parse errors
									}
								}
							}

							// If no matches, return empty result
							if (matchingIds.length === 0) {
								return {
									data: [] as Prisma.Result<T, A, "findMany">[number][],
									total,
									totalPages,
									page,
									perPage: limitPerPage,
									hasNext: page < totalPages,
									hasPrev: page > 1,
									scores: scores.size > 0 ? scores : undefined,
									highlights: highlights.size > 0 ? highlights : undefined,
									facets: facetResult
										? (JSON.parse(
												facetResult[0]?.facets ?? "{}",
											) as FacetResults)
										: undefined,
									took: Date.now() - startTime,
								};
							}

							// Build findMany query with the matching IDs
							// This ensures proper typing and relation loading
							const findManyArgs: Record<string, unknown> = {
								where: {
									...prismaWhere,
									[config.keyField]: { in: matchingIds },
								},
								...restArgs,
							};

							if (include) findManyArgs.include = include;
							if (select) findManyArgs.select = select;

							// Order by search score by default, or use provided orderBy
							if (prismaOrderBy) {
								findManyArgs.orderBy = prismaOrderBy;
							}

							if (debug) {
								console.log(
									"[Search] FindMany args:",
									JSON.stringify(findManyArgs, null, 2),
								);
							}

							// Fetch full records with Prisma
							const modelDelegate = (
								context as unknown as Record<string, unknown>
							).findMany;
							const typedData = await (
								modelDelegate as (args: unknown) => Promise<unknown[]>
							)(findManyArgs);

							// Sort results by search score if needed
							let sortedData = typedData;
							if (orderBySearchScore && scores.size > 0) {
								sortedData = [...typedData].sort((a, b) => {
									const aId = String(
										(a as Record<string, unknown>)[config.keyField],
									);
									const bId = String(
										(b as Record<string, unknown>)[config.keyField],
									);
									const aScore = scores.get(aId) ?? 0;
									const bScore = scores.get(bId) ?? 0;
									return bScore - aScore;
								});
							}

							const took = Date.now() - startTime;

							if (debug) {
								console.log(`[Search] Completed in ${took}ms`, {
									total,
									returned: sortedData.length,
								});
							}

							return {
								data: sortedData as Prisma.Result<T, A, "findMany">[number][],
								total,
								totalPages,
								page,
								perPage: limitPerPage,
								hasNext: page < totalPages,
								hasPrev: page > 1,
								scores: scores.size > 0 ? scores : undefined,
								highlights: highlights.size > 0 ? highlights : undefined,
								facets: facetResult
									? (JSON.parse(facetResult[0]?.facets ?? "{}") as FacetResults)
									: undefined,
								took,
							};
						} catch (error) {
							throw new SearchError(
								`Search failed: ${error instanceof Error ? error.message : "Unknown error"}`,
								{ cause: error },
							);
						}
					},

					/**
					 * Search with debug information returned
					 */
					async searchDebug<T, A extends SearchArgs<T>>(
						this: T,
						args?: A,
					): Promise<{
						result: SearchResult<Prisma.Result<T, A, "findMany">[number]>;
						debug: DebugInfo;
					}> {
						const startTime = Date.now();
						const context = Prisma.getExtensionContext(this);
						const modelName = context.$name;
						const config = searchConfigRegistry.get(modelName ?? "");

						if (!config) {
							throw new SearchError(
								`No search configuration for model: ${modelName}`,
							);
						}

						// First run the search to get results
						const searchMethod = (this as unknown as Record<string, unknown>)
							.search;
						const result = await (
							searchMethod as (a: unknown) => Promise<SearchResult<unknown>>
						)(args);

						// Build debug query
						const { search: searchParams } = (args ?? {}) as {
							search?: SearchParams;
						};

						const { dataQuery } = buildQueries(config, {
							query: searchParams?.query,
							mode: searchParams?.mode ?? config.defaultMode ?? "any",
							offset: 0,
							limit: searchParams?.perPage ?? 20,
							order: "desc",
							countTotal: true,
						});

						const explainQuery = `EXPLAIN ANALYZE ${dataQuery.sql}`;

						let explain = "";
						try {
							const explainResult = await client.$queryRawUnsafe<
								{ "QUERY PLAN": string }[]
							>(explainQuery, ...dataQuery.params);
							explain = explainResult.map((r) => r["QUERY PLAN"]).join("\n");
						} catch {
							explain = "Could not get explain plan";
						}

						return {
							result: result as SearchResult<
								Prisma.Result<T, A, "findMany">[number]
							>,
							debug: {
								sql: dataQuery.sql,
								params: dataQuery.params,
								time: Date.now() - startTime,
								explain: explain,
							},
						};
					},

					/**
					 * Get autocomplete suggestions for a field
					 */
					async autocomplete<T>(
						this: T,
						prefix: string,
						options: { field?: string; limit?: number } = {},
					): Promise<string[]> {
						const context = Prisma.getExtensionContext(this);
						const modelName = context.$name?.toLowerCase();
						const config = searchConfigRegistry.get(modelName ?? "");

						if (!config || !prefix.trim()) {
							return [];
						}

						const field = options.field ?? config.fields[0]?.field;
						if (!field) return [];

						const limit = options.limit ?? 10;

						const query = `
							SELECT DISTINCT "${field}"
							FROM "${config.table}"
							WHERE "${field}" ILIKE $1
							ORDER BY "${field}"
							LIMIT ${limit}
						`;

						const results = await client.$queryRawUnsafe<
							{ [key: string]: string }[]
						>(query, `${prefix.trim()}%`);

						return results.map((r) => r[field]);
					},

					/**
					 * Find similar documents using ParadeDB's more_like_this
					 */
					async findSimilar<T, A extends Prisma.Args<T, "findMany">>(
						this: T,
						documentId: string,
						options?: { limit?: number; minScore?: number } & A,
					): Promise<Prisma.Result<T, A, "findMany">> {
						const context = Prisma.getExtensionContext(this);
						const modelName = context.$name?.toLowerCase();
						const config = searchConfigRegistry.get(modelName ?? "");

						if (!config) {
							throw new SearchError(
								`No search configuration for model: ${modelName}`,
							);
						}

						const {
							limit = 10,
							minScore = 0.5,
							...prismaArgs
						} = (options ?? {}) as {
							limit?: number;
							minScore?: number;
						} & Record<string, unknown>;

						const query = `
							SELECT "${config.keyField}"
							FROM "${config.table}"
							WHERE "${config.keyField}" @@@ paradedb.more_like_this($1)
							AND paradedb.score("${config.keyField}") >= $2
							ORDER BY paradedb.score("${config.keyField}") DESC
							LIMIT ${limit}
						`;

						const results = await client.$queryRawUnsafe<
							{ [key: string]: string }[]
						>(query, documentId, minScore);

						const matchingIds = results.map((r) => r[config.keyField]);

						if (matchingIds.length === 0) {
							return [] as unknown as Prisma.Result<T, A, "findMany">;
						}

						// Fetch full records with Prisma
						const findManyArgs: Record<string, unknown> = {
							...prismaArgs,
							where: {
								...(prismaArgs.where as Record<string, unknown>),
								[config.keyField]: { in: matchingIds },
							},
						};

						const modelDelegate = (
							context as unknown as Record<string, unknown>
						).findMany;
						return (modelDelegate as (args: unknown) => Promise<unknown[]>)(
							findManyArgs,
						) as Promise<Prisma.Result<T, A, "findMany">>;
					},

					/**
					 * Reindex the search index for this model
					 */
					async reindex(
						this: unknown,
					): Promise<{ success: boolean; message: string }> {
						const context = Prisma.getExtensionContext(this);
						const modelName = context.$name?.toLowerCase();
						const config = searchConfigRegistry.get(modelName ?? "");

						if (!config) {
							throw new SearchError(
								`No search configuration for model: ${modelName}`,
							);
						}

						try {
							await client.$executeRawUnsafe(`REINDEX INDEX "${config.index}"`);

							return {
								success: true,
								message: `Successfully reindexed ${config.index}`,
							};
						} catch (error) {
							return {
								success: false,
								message: `Reindex failed: ${error instanceof Error ? error.message : "Unknown error"}`,
							};
						}
					},
				},
			},
		});
	});
}

// ============================================================================
// EXPORTS
// ============================================================================

export {
	searchConfigRegistry,
	SearchError,
	SearchOperators,
	pgSearchExtension,
};

export type {
	SearchParams,
	SearchResult,
	SearchArgs,
	ModelSearchConfig,
	FieldConfig,
	JoinConfig,
	MatchMode,
	Tokenizer,
	FacetConfig,
	FacetResults,
	HighlightResult,
	DebugInfo,
	PgSearchExtensionOptions,
};

export type ConfiguredSearchModelMap = {
	user: Prisma.UserFindManyArgs;
	// add new configured models here, e.g.:
	// post: Prisma.PostFindManyArgs;
};

export type PrismaSearchParams<TModel extends keyof ConfiguredSearchModelMap> =
	SearchArgs<unknown, ConfiguredSearchModelMap[TModel]>;
