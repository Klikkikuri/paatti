const getLogger = (name) => {
    return (...args) => {
        console.log(`[⛵ ${name}]:`, ...args, `\nStack:\n${Error().stack}`);
    };
};

