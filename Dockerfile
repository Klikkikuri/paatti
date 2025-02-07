FROM python:3.12.9-alpine

WORKDIR /app

COPY tests/requirements.txt tests/requirements.txt

RUN python -m pip install -r tests/requirements.txt

COPY . .

CMD ["pytest", "tests/"]
