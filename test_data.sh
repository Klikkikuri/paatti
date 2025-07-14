#!/bin/bash

set -e

# Remove old computed hashes.
rm -f test_data/hashes.txt

docker build -t suolacli --target cli suola/

# Run suola on the URLs found in test data file.
for url in $(cat test_data/urls.txt);
do
    echo !! Hashing: $url
    docker run suolacli -sign -url $url | sed -n -e 's/^.*Signature: //p' >> test_data/hashes.txt
done

python3 test_data/generate_data.py
