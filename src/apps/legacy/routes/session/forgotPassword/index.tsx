import { ForgotPasswordAction } from '@jellyfin/sdk/lib/generated-client/models/forgot-password-action';
import { useMutation } from '@tanstack/react-query';
import React, { useCallback, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import alert from 'components/alert';
import Page from 'components/Page';
import Button from 'elements/emby-button/Button';
import Input from 'elements/emby-input/Input';
import globalize from 'lib/globalize';
import ServerConnections from 'lib/jellyfin-apiclient/ServerConnections';
import { getAuthenticationApi } from 'utils/sdk/authentication-api';
import { isValidUrl } from 'utils/url';
import shell from 'scripts/shell';

export const ForgotPasswordPage = () => {
    const navigate = useNavigate();
    const [username, setUsername] = useState('');

    const forgotPasswordMutation = useMutation({
        mutationFn: async (enteredUsername: string) => {
            const response = await fetch('https://utils.jellyfin.nu/api/reset', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    username: enteredUsername
                })
            });

            if (!response.ok) {
                throw new Error('Failed to request password reset');
            }

            return response;
        },
        onSuccess: () => {
            return alert({
                text: 'Check your email for reset link. <br/><br/> Press button below to continue.',
                title: globalize.translate('ButtonForgotPassword')
            }).then(() => {
                navigate('/login');
            });
        },
        onError: () => {
            return alert({
                text: 'Failed to request password reset. Please try again or contact an administrator.',
                title: globalize.translate('HeaderError')
            });
        }
    });

    const handleCancel = useCallback(() => {
        navigate(-1);
    }, [navigate]);

    const handleSubmit = useCallback(async (e: React.FormEvent) => {
        e.preventDefault();
        forgotPasswordMutation.mutate(username);
    }, [username, forgotPasswordMutation]);

    const handleUsernameChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
        setUsername(e.target.value);
    }, []);

    return (
        <Page
            id='forgotPasswordPage'
            className='standalonePage forgotPasswordPage mainAnimatedPage'
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
                        <h1 style={{ marginBottom: '1em' }}>{globalize.translate('ButtonForgotPassword')}</h1>

                        <div className='inputContainer'>
                            <Input
                                type='text'
                                id='txtName'
                                label={globalize.translate('LabelUser')}
                                autoComplete='off'
                                value={username}
                                onChange={handleUsernameChange}
                            />
                            <div className='fieldDescription'>
                                {globalize.translate('LabelForgotPasswordUsernameHelp')}
                            </div>
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

export default ForgotPasswordPage;
