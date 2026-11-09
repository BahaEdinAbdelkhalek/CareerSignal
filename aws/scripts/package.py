from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile

REPOSITORY = Path(__file__).resolve().parents[2]
AWS_ROOT = REPOSITORY / "aws"
OUTPUT = AWS_ROOT / "build" / "careersignal-aws.zip"
REQUIRED_PACKAGES = (
    "@aws-sdk/client-dynamodb",
    "@aws-sdk/client-s3",
    "@aws-sdk/client-ssm",
    "@aws-sdk/client-sfn",
    "@aws-sdk/lib-dynamodb",
    "@aws-sdk/s3-request-presigner",
    "pdfjs-dist",
)


def main():
    node_modules = AWS_ROOT / "node_modules"
    missing = [name for name in REQUIRED_PACKAGES if not (node_modules / name).exists()]
    if missing:
        raise SystemExit(
            "AWS runtime packages are missing. Run `npm ci --omit=dev` in aws/ first. "
            "Missing: " + ", ".join(missing)
        )

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    included = []
    roots = [
        AWS_ROOT / "lambda",
        AWS_ROOT / "lib",
        node_modules,
        REPOSITORY / "src" / "services" / "foundry.js",
        REPOSITORY / "src" / "services" / "getprospect.js",
        REPOSITORY / "src" / "services" / "hr-titles.js",
        REPOSITORY / "src" / "services" / "key-vault.js",
        REPOSITORY / "src" / "services" / "matching.js",
    ]

    with ZipFile(OUTPUT, "w", compression=ZIP_DEFLATED, compresslevel=6) as archive:
        for root in roots:
            if not root.exists():
                raise SystemExit(f"Required runtime path is missing: {root.relative_to(REPOSITORY)}")
            files = [root] if root.is_file() else sorted(path for path in root.rglob("*") if path.is_file())
            for path in files:
                if path.parent.name == ".bin":
                    continue
                archive.write(path, path.relative_to(REPOSITORY).as_posix())
                included.append(path)

    print(f"Packaged {len(included)} files: {OUTPUT.relative_to(REPOSITORY)}")
    print(f"Artifact size: {OUTPUT.stat().st_size} bytes")


if __name__ == "__main__":
    main()
