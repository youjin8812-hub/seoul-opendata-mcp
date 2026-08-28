const isDev = process.env.NODE_ENV !== "production";
export const logger = {
    info: (msg, data) => {
        if (isDev)
            process.stderr.write(`[INFO] ${msg}${data ? " " + JSON.stringify(data) : ""}\n`);
    },
    warn: (msg, data) => {
        process.stderr.write(`[WARN] ${msg}${data ? " " + JSON.stringify(data) : ""}\n`);
    },
    error: (msg, data) => {
        process.stderr.write(`[ERROR] ${msg}${data ? " " + JSON.stringify(data) : ""}\n`);
    },
};
//# sourceMappingURL=logger.js.map
