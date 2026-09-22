import os

# Supply complete scheme/host/port origins as a comma-separated local setting.
# Production values belong in the ignored deployment environment, not Git.
CSRF_TRUSTED_ORIGINS = [
  origin.strip()
  for origin in os.environ.get("SAG_CSRF_TRUSTED_ORIGINS", "http://localhost:9000").split(",")
  if origin.strip()
]
