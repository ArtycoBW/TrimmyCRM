"""Process-wide test settings that must not inherit a developer shell's values."""

import os

# Some environments define DEBUG with non-boolean values (for example, "release").
# The application imports its settings while test modules are collected, so this has
# to be set before those imports instead of relying on a per-test fixture.
os.environ["DEBUG"] = "false"
os.environ["ENVIRONMENT"] = "test"
