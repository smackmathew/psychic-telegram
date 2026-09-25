from alembic import command
from alembic.config import Config

from tests.conftest import BACKEND_DIR


def test_models_match_migrations(engine):
    """Fails when app/models.py changes without a matching Alembic migration.

    Fix it with: alembic revision --autogenerate -m "describe the change"
    """
    cfg = Config(str(BACKEND_DIR / "alembic.ini"))
    cfg.set_main_option("script_location", str(BACKEND_DIR / "alembic"))
    command.check(cfg)


def test_migrations_downgrade_and_upgrade_cleanly(engine):
    cfg = Config(str(BACKEND_DIR / "alembic.ini"))
    cfg.set_main_option("script_location", str(BACKEND_DIR / "alembic"))
    command.downgrade(cfg, "base")
    command.upgrade(cfg, "head")
