import { prisma } from 'db';
import { requireActiveOrg } from 'auth';

export async function loader({ request }: { request: Request }) {
  const org = await requireActiveOrg(request);
  const runs = await prisma.agentRun.findMany({ where: { orgId: org.id } });
  return { runs };
}
