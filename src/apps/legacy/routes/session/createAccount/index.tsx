import { useMutation } from '@tanstack/react-query';
import React, { useCallback, useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

import alert from 'components/alert';
import Page from 'components/Page';
import Button from 'elements/emby-button/Button';
import Input from 'elements/emby-input/Input';
import globalize from 'lib/globalize';

export const CreateAccountPage = () => {
    const navigate = useNavigate();
    const location = useLocation();

    const [code, setCode] = useState('');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');

    useEffect(() => {
        // Extract code from URL query parameters or hash (e.g. ?code=xyz or #/createaccount?code=xyz)
        const docParams = new URLSearchParams(window.location.search);
        let initialCode = docParams.get('code') || new URLSearchParams(location.search).get('code');

        if (!initialCode && window.location.hash && window.location.hash.includes('?')) {
            const queryPart = window.location.hash.split('?')[1];
            initialCode = new URLSearchParams(queryPart).get('code');
        }

        if (initialCode) {
            setCode(initialCode);
        } else {
            alert({
                text: 'Invalid or missing invite link.',
                title: globalize.translate('HeaderError')
            }).then(() => {
                navigate('/login');
            });
        }
    }, [location, navigate]);

    const createAccountMutation = useMutation({
        mutationFn: async () => {
            if (!code.trim()) {
                throw new Error('Invalid or missing invite link.');
            }
            if (password !== confirmPassword) {
                throw new Error('Passwords do not match');
            }
            if (password.length < 5) {
                throw new Error('Password must be at least 5 characters');
            }

            const response = await fetch('https://utils.jellyfin.nu/api/create', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    email: email.trim().toLowerCase(),
                    password,
                    code: code.trim()
                })
            });

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                throw new Error(errorData.message || errorData.error || 'Failed to create account');
            }

            return response;
        },
        onSuccess: () => {
            return alert({
                text: 'Your account has been created. A confirmation email has been dispatched to your address. Please verify your email to complete registration and sign in.<br><br>Be sure to check your spam or junk folder if the email does not appear shortly.',
                title: 'Email Verification Required'
            }).then(() => {
                navigate('/login');
            });
        },
        onError: (error: Error) => {
            return alert({
                text: error.message || 'Failed to create account. Please check your invite code and try again.',
                title: globalize.translate('HeaderError')
            });
        }
    });

    const handleCancel = useCallback(() => {
        navigate('/login');
    }, [navigate]);

    const handleSubmit = useCallback(async (e: React.FormEvent) => {
        e.preventDefault();
        createAccountMutation.mutate();
    }, [createAccountMutation]);

    return (
        <Page
            id='createAccountPage'
            className='standalonePage createAccountPage forgotPasswordPage mainAnimatedPage'
            shouldAutoFocus
        >
            <div className='padded-left padded-right padded-bottom-page'>
                <form
                    className='forgotPasswordForm'
                    style={{ textAlign: 'center', margin: '0 auto' }}
                    onSubmit={handleSubmit}
                >
                    <div className='flex align-items-center justify-content-center' style={{ marginBottom: '1.5em' }}>
                        <div className='pageTitleWithDefaultLogo' style={{ height: '3.5em', width: '12em', backgroundSize: 'contain', backgroundRepeat: 'no-repeat', backgroundPosition: 'center' }} />
                    </div>

                    <div style={{ textAlign: 'left' }}>
                        <h1 style={{ marginBottom: '1em' }}>Create Account</h1>

                        <div className='inputContainer'>
                            <Input
                                type='email'
                                id='email'
                                label='Email'
                                autoComplete='off'
                                autoCapitalize='off'
                                required
                                value={email}
                                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEmail(e.target.value.toLowerCase())}
                            />
                            <div className='fieldDescription'>Enter your email</div>
                        </div>

                        <div className='inputContainer'>
                            <Input
                                type='password'
                                id='password'
                                label={globalize.translate('LabelPassword')}
                                autoComplete='new-password'
                                required
                                value={password}
                                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPassword(e.target.value)}
                            />
                            <div className='fieldDescription'>Minimum 5 characters</div>
                        </div>

                        <div className='inputContainer'>
                            <Input
                                type='password'
                                id='confirmPassword'
                                label='Re-enter Password'
                                autoComplete='new-password'
                                required
                                value={confirmPassword}
                                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setConfirmPassword(e.target.value)}
                            />
                            <div className='fieldDescription'>Re-enter your password</div>
                        </div>

                        <div>
                            <Button
                                type='submit'
                                id='btnSubmit'
                                className='raised submit block'
                                title={globalize.translate('ButtonSubmit')}
                            />

                            <Button
                                type='button'
                                id='btnCancel'
                                className='raised cancel block btnCancel'
                                title={globalize.translate('ButtonCancel')}
                                onClick={handleCancel}
                            />
                        </div>
                    </div>
                </form>
            </div>
        </Page>
    );
};

export default CreateAccountPage;
