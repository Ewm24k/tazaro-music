const fs = require('fs');
const path = require('path');

exports.handler = async function (event, context) {
    // Resolve path to the sheet folder
    const baseDir = path.resolve(__dirname, '../../sheet');
    const allowedExtensions = ['.pdf', '.xml', '.musicxml', '.mid', '.midi'];
    const discoveredFiles = [];
    const instruments = ['piano', 'guitar'];

    try {
        instruments.forEach(instrument => {
            const dirPath = path.join(baseDir, instrument);
            if (fs.existsSync(dirPath)) {
                const files = fs.readdirSync(dirPath);
                files.forEach(file => {
                    const ext = path.extname(file).toLowerCase();
                    if (allowedExtensions.includes(ext)) {
                        discoveredFiles.push(`sheet/${instrument}/${file}`);
                    }
                });
            }
        });

        return {
            statusCode: 200,
            headers: {
                "Content-Type": "application/json",
                "Access-Control-Allow-Origin": "*"
            },
            body: JSON.stringify(discoveredFiles)
        };
    } catch (err) {
        return {
            statusCode: 500,
            body: JSON.stringify({ error: err.message })
        };
    }
};
