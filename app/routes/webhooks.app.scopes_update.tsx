import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, session, payload } = await authenticate.webhook(request);
  const current = payload?.current as string[] | undefined;
  if (session) {
    await prisma.session.update({
      where: { id: session.id },
      data: { scope: current?.join(",") },
    });
  }
  console.log(`Scopes updated for ${shop}: ${current?.join(",")}`);
  return new Response();
};
