import { PrismaClient } from "@prisma/client";

// Single Prisma client across HMR reloads in dev.
declare global {
  var prismaGlobal: PrismaClient | undefined;
}

const prisma = global.prismaGlobal ?? new PrismaClient();
if (process.env.NODE_ENV !== "production") global.prismaGlobal = prisma;

export default prisma;
