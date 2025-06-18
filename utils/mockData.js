const bcrypt = require('bcryptjs');

let users = [
  {
    id: '1',
    username: 'demo',
    email: 'demo@example.com',
    password: bcrypt.hashSync('password', 10),
    role: 'user',
    createdAt: '2024-01-01T00:00:00Z'
  },
  {
    id: '2',
    username: 'admin',
    email: 'admin@example.com', 
    password: bcrypt.hashSync('admin123', 10),
    role: 'admin',
    createdAt: '2024-01-01T00:00:00Z'
  }
];

let cases = [
  {
    id: 'CASE-001',
    title: 'Website Bug Investigation',
    description: 'Critical layout issues on homepage affecting user experience',
    status: 'active',
    priority: 'high',
    createdAt: '2024-06-10T09:00:00Z',
    updatedAt: '2024-06-11T14:30:00Z',
    assignedTo: 'demo',
    tags: ['bug', 'frontend', 'ui', 'critical'],
    metadata: {
      totalScreenshots: 8,
      totalVideos: 2,
      lastActivity: '2024-06-11T14:30:00Z',
      totalFileSize: 15728640
    }
  },
  {
    id: 'CASE-002',
    title: 'Performance Issue Analysis',
    description: 'Page loading times significantly slower than expected',
    status: 'pending',
    priority: 'medium',
    createdAt: '2024-06-09T10:15:00Z',
    updatedAt: '2024-06-09T16:45:00Z',
    assignedTo: 'demo',
    tags: ['performance', 'optimization', 'backend'],
    metadata: {
      totalScreenshots: 12,
      totalVideos: 1,
      lastActivity: '2024-06-09T16:45:00Z',
      totalFileSize: 28311552
    }
  }
];

let files = [];

const generateCaseId = () => {
  const nextNumber = cases.length + 1;
  return `CASE-${String(nextNumber).padStart(3, '0')}`;
};

module.exports = {
  users,
  cases,
  files,
  generateCaseId
};
