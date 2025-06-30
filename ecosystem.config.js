module.exports = {
  apps: [{
    name: 'beatchat',
    script: 'server/index.js',
    env: {
MONGODB_URI: 'mongodb+srv://beatchat:M4nG0T4nG0!@cluster0.gzkdoz1.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0',
PORT: 3000    }
  }]
}