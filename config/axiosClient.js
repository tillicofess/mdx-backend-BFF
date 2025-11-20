import axios from 'axios';

const axiosClient = axios.create({
    timeout: 5000
});

axiosClient.interceptors.response.use(
    res => res,
    err => {
        console.error("Axios error:", err.response?.data || err.message);
        throw err;
    }
);

export default axiosClient;
