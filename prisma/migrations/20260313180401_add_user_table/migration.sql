CREATE EXTENSION IF NOT EXISTS pg_search;


-- CreateTable
CREATE TABLE "user" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "emailVerified" BOOLEAN NOT NULL,
    "image" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "role" TEXT,

    CONSTRAINT "user_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX user_search_idx ON public."user"
USING bm25 (id, name, email)
WITH (
  key_field = 'id',
  text_fields = '{
    "name": {
      "tokenizer": {"type": "default"},
      "normalizer": "lowercase"
    },
    "name_ngram": {
      "tokenizer": {"type": "ngram", "min_gram": 3, "max_gram": 4, "prefix_only": true},
      "column": "name"
    },
    "email": {
      "tokenizer": {"type": "default"},
      "normalizer": "lowercase"
    },
    "email_regex": {
      "tokenizer": {"type": "regex", "pattern": "@"},
      "column": "email"
    }
  }'
);

-- CreateIndex
CREATE UNIQUE INDEX "user_email_key" ON "user"("email");
