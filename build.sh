#!/bin/bash
set -e

echo "Building server..."
cd server
npm run build
cd ..

echo "Building client..."
cd client
npm run build
cd ..

echo "Copying client build to server public folder..."
rm -rf server/public
cp -r client/dist server/public

echo "Build complete!"
