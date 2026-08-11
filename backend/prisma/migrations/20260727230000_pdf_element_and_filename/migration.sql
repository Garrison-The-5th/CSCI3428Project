-- AlterEnum
ALTER TYPE "ElementType" ADD VALUE 'PDF';

-- AlterTable
ALTER TABLE "Element" ADD COLUMN     "fileName" TEXT;

