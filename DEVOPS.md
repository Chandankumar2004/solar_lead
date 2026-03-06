# DevOps Blueprint

## Environments
- `web`: deploy to Vercel
- `api`: deploy to AWS ECS (Fargate) or EC2 with Docker
- `db`: AWS RDS PostgreSQL
- `cache/queue`: AWS ElastiCache Redis
- `files`: Amazon S3 + CloudFront
- `monitoring`: CloudWatch + Sentry (web/mobile/api)

## CI/CD (GitHub Actions)
1. Install dependencies
2. Typecheck/build `packages/shared`, `apps/api`, `apps/web`, `apps/mobile`
3. Run Prisma migrations against target env
4. Deploy web to Vercel
5. Build/push API container and roll ECS service

## Runtime notes
- Access and refresh JWT are set in HTTP-only cookies by API.
- Mobile never stores AWS credentials; it requests S3 pre-signed URLs from API.
- BullMQ worker currently runs in API process; in production run separate worker task.

