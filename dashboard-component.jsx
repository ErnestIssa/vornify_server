import React from 'react';
import { H1, H2, Box, Text } from '@adminjs/design-system';

const Dashboard = () => {
  return (
    <Box>
      <H1>Peak Mode Admin Dashboard</H1>
      <Box mt="lg">
        <H2>Welcome to Peak Mode Admin Panel</H2>
        <Text>
          Manage your products, orders, customers, and reviews from this dashboard.
        </Text>
        <Box mt="lg">
          <Text>
            <strong>Quick Stats:</strong>
          </Text>
          <ul>
            <li>View and manage all products in your inventory</li>
            <li>Track orders and their status</li>
            <li>Manage customer information</li>
            <li>Moderate product reviews</li>
          </ul>
        </Box>
      </Box>
    </Box>
  );
};

export default Dashboard;
