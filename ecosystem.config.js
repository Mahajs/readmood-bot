module.exports = {
  apps: [
    {
      name: "readmood-bot",
      script: "src/index.js",
      cwd: "/opt/readmood-bot",
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      watch: false,
      max_restarts: 10,
      restart_delay: 3000,
      env: {
        NODE_ENV: "production"
      }
    }
  ]
};
