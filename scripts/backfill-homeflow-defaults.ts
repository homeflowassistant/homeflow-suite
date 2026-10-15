import {
  listInstallations,
  updateCustomValuesOnInstall,
} from "../server/ghl-service.js";

const apply = process.argv.includes("--apply");

async function main() {
  const installations = await listInstallations();

  if (installations.length === 0) {
    console.log(
      "No installations found. Verify DATABASE_URL before running the backfill."
    );
    return;
  }

  console.log(`Found ${installations.length} installed location(s).`);

  if (!apply) {
    console.log(
      "Dry run only. Re-run with --apply to seed missing or empty defaults."
    );
    for (const installation of installations) {
      console.log(`- ${installation.locationId}`);
    }
    return;
  }

  let succeeded = 0;
  let failed = 0;
  for (const installation of installations) {
    try {
      console.log(`[Backfill] Starting ${installation.locationId}`);
      await updateCustomValuesOnInstall(installation.locationId);
      succeeded += 1;
      console.log(`[Backfill] Finished ${installation.locationId}`);
    } catch (error) {
      failed += 1;
      console.error(`[Backfill] Failed ${installation.locationId}:`, error);
    }
  }

  console.log(
    `[Backfill] Complete. Succeeded: ${succeeded}. Failed: ${failed}.`
  );
  if (failed > 0) process.exitCode = 1;
}

main().catch(error => {
  console.error("[Backfill] Fatal error:", error);
  process.exitCode = 1;
});
