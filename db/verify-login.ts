import "dotenv/config";
import { findUserByEmail } from "../api/queries/users";
import { verifyPassword } from "../api/lib/password";

async function main() {
  const email = "sandeep@aumentoinfoway.com";
  const password = "Aumento@dev2026";
  const user = await findUserByEmail(email);

  if (!user) {
    console.log("FAIL: user not found");
    process.exit(1);
  }

  const passwordOk = user.passwordHash
    ? await verifyPassword(password, user.passwordHash)
    : false;

  console.log(
    JSON.stringify(
      {
        email: user.email,
        role: user.role,
        status: user.status,
        hasPassword: Boolean(user.passwordHash),
        passwordOk,
      },
      null,
      2,
    ),
  );

  process.exit(passwordOk ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
