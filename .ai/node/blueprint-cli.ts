import { configuredBlueprintProvider, createBlueprintProvider } from "./blueprint-provider.js";

export type BlueprintCommand = "discover" | "scan" | "status" | "validate" | "resolve";

function option(argv: string[], name: string) {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : undefined;
}

export function runBlueprintCommand(command: BlueprintCommand, argv: string[]) {
  const manifest = option(argv, "--manifest");
  const provider = manifest ? createBlueprintProvider(manifest) : configuredBlueprintProvider();
  if (!provider)
    throw new Error(
      "Blueprint provider is disabled; configure knowledge.provider: blueprint or pass --manifest <path>",
    );
  if (command === "discover" || command === "scan" || command === "status")
    return command === "discover"
      ? provider.discover()
      : command === "scan"
        ? { ...provider.status(), ...provider.validate() }
        : provider.status();
  if (command === "validate") return provider.validate();
  const id = option(argv, "--id");
  if (!id) throw new Error("blueprint resolve requires --id <document-id>");
  return provider.resolve(id);
}
