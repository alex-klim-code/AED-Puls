import { db, memberships, organizations, users } from "@workspace/db";

export const mockAccountIdentities = {
  USER: "hackathon-judges:USER",
  PROVIDER: "hackathon-judges:ORGANIZATIONS",
  ADMIN: "hackathon-judges:ADMIN",
} as const;
export type MockAccountRole = keyof typeof mockAccountIdentities;

/** Three persistent normal accounts; no AED seeding or ownership changes. */
export async function ensureMockAccounts() {
  return db.transaction(async tx => {
    const [organization] = await tx.insert(organizations).values({
      id: "d0000000-0000-4000-8000-000000000001",
      name: "Organizacja AED Puls", isDemo: false,
    }).onConflictDoUpdate({
      target: organizations.id, set: { name: "Organizacja AED Puls", isDemo: false },
    }).returning();
    const accounts = {} as Record<MockAccountRole, typeof users.$inferSelect>;
    const names = { USER: "Użytkownik AED Puls", PROVIDER: "Organizacja AED Puls", ADMIN: "Administrator AED Puls" };
    for (const role of ["USER", "PROVIDER", "ADMIN"] as const) {
      const data = {
        name: names[role], role, isDemo: false,
        organizationId: role === "PROVIDER" ? organization!.id : null,
      };
      const [account] = await tx.insert(users).values({
        ...data, demoIdentity: mockAccountIdentities[role],
      }).onConflictDoUpdate({ target: users.demoIdentity, set: data }).returning();
      accounts[role] = account!;
    }
    await tx.insert(memberships).values({
      userId: accounts.PROVIDER.id, organizationId: organization!.id,
    }).onConflictDoNothing();
    return accounts;
  });
}
