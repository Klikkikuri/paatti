"""`paatti-devserver`: start the development server."""

import uvicorn
from niitti.logging import setup_logging
from niitti.settings import LoggingSettings

from .app import create_app
from .settings import Settings


def main():
    settings = Settings.from_command_line()
    setup_logging(LoggingSettings(LOG_LEVEL=settings.log_level))
    print(settings.startup_summary(), flush=True)
    uvicorn.run(create_app(settings), host=settings.host, port=settings.port, log_config=None)


if __name__ == "__main__":
    main()
