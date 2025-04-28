#!/bin/bash

set -e

# Remove old computed hashes.
rm -f test_data/hashes.txt

# Run suola on the URLs found in test data file.
docker build -t runsuola --target runnative suola/

for url in $(cat test_data/urls.txt);
do
    echo !! Hashing: $url
    docker run runsuola -sign -url $url | sed -n -e 's/^.*Signature: //p' >> test_data/hashes.txt
done

python3 test_data/generate_data.py
